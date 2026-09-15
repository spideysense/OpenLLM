// The LAN listener serves encrypted protocol frames only. It never serves web
// JavaScript, plaintext compatibility APIs, artifacts, or the inference engine.
const http = require('node:http');
async function start({ port = 4001, upstreamPort, host = '0.0.0.0' }) {
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/secure' || req.headers.origin) {
      res.writeHead(404); res.end(); return;
    }
    let size = 0;
    const upstream = http.request({ hostname: '127.0.0.1', port: upstreamPort, path: '/v1/secure', method: 'POST', headers: { 'Content-Type': 'application/json' } }, response => {
      res.writeHead(response.statusCode, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
      response.pipe(res);
    });
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 12 * 1024 * 1024) { upstream.destroy(); res.writeHead(413); res.end(); req.destroy(); }
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  });
  server.maxConnections = 32;
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return { port: server.address().port, stop: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}
module.exports = { start };
