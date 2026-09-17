'use strict';
const net = require('node:net');
const dns = require('node:dns').promises;
const http = require('node:http');
const https = require('node:https');

function localAddress(ip) {
  if (net.isIP(ip) !== 4) return false;
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}
async function validateLocalUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Use the local address of your Home Assistant.');
  if (url.pathname !== '/') throw new Error('Use the server address without a path.');
  const records = await dns.lookup(url.hostname, { all: true });
  if (!records.length || records.some(r => !localAddress(r.address))) throw new Error('Home Assistant must be on your local network.');
  return { origin: url.origin, address: records[0].address };
}
// Pin the validated address for each request, disable redirects and cap data.
// This prevents DNS rebinding or a redirect from leaking the integration token.
async function haRequest(connection, path, data) {
  const target = await validateLocalUrl(connection.url);
  const url = new URL(target.origin + '/api/' + path);
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request(url, { method: data ? 'POST' : 'GET',
      lookup: (_host, options, cb) => options?.all ? cb(null, [{ address: target.address, family: 4 }]) : cb(null, target.address, 4),
      headers: { Authorization: 'Bearer ' + connection.token, 'Content-Type': 'application/json' },
    }, res => {
      if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); return reject(new Error('Home Assistant could not complete this request. Check the connection and access token.')); }
      let body = '', size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > 2e6) { req.destroy(); reject(new Error('Device response too large.')); } else body += chunk; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('Unexpected Home Assistant response.')); } });
    });
    req.setTimeout(6000, () => req.destroy(new Error('Home Assistant took too long to respond.')));
    req.on('error', () => reject(new Error('Could not reach Home Assistant on your home network.')));
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}
function visibleDevices(states) {
  return states.filter(s => /^(light|climate|sensor|binary_sensor)\./.test(s.entity_id)).map(s => ({
    id: s.entity_id, name: String(s.attributes?.friendly_name || s.entity_id).slice(0, 120),
    kind: s.entity_id.split('.')[0], state: s.state, unit: s.attributes?.unit_of_measurement || '',
    class: s.attributes?.device_class || '', roomId: null, enabled: false,
  }));
}
module.exports = { localAddress, validateLocalUrl, haRequest, visibleDevices };
