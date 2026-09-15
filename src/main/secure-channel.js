// Application encryption: the tunnel sees ciphertext, never the pairing secret.
// High-entropy pairing keys derive separate request/response keys and lookup IDs.
const crypto = require('crypto');
const { Readable, Writable } = require('stream');
const seen = new Map();
const hash = (text) => crypto.createHash('sha256').update(text).digest();
function keys(secret) {
  return {
    id: hash('aspen-id-v1:' + secret).toString('hex'),
    request: hash('aspen-request-v1:' + secret),
    response: hash('aspen-response-v1:' + secret)
  };
}
function seal(key, value, aad) {
  const nonce = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, nonce);
  c.setAAD(Buffer.from(aad));
  const encrypted = Buffer.concat([
    c.update(JSON.stringify(value)),
    c.final(),
    c.getAuthTag()
  ]);
  return {
    nonce: nonce.toString('base64'),
    data: encrypted.toString('base64')
  };
}
function open(key, envelope, aad) {
  const nonce = Buffer.from(envelope.nonce || '', 'base64');
  const encrypted = Buffer.from(envelope.data || '', 'base64');
  if (nonce.length !== 12 || encrypted.length < 16 || nonce.toString('base64') !== envelope.nonce || encrypted.toString('base64') !== envelope.data)
    throw new Error('Invalid envelope');
  const c = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  c.setAAD(Buffer.from(aad));
  c.setAuthTag(encrypted.subarray(-16));
  return JSON.parse(
    Buffer.concat([c.update(encrypted.subarray(0, -16)), c.final()]).toString()
  );
}
async function handle(req, res, dispatch) {
  try {
    let size = 0;
    const chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > 12 * 1024 * 1024) throw new Error('Request too large');
      chunks.push(c);
    }
    const envelope = JSON.parse(Buffer.concat(chunks).toString());
    const key = require('./apikeys').listKeys().find(k => keys(k.secret).id === envelope.id) || require('./enrollment').transportKeys().find(k => keys(k.secret).id === envelope.id) || require('./vault').get().transportKeys().find(k => keys(k.secret).id === envelope.id);
    if (!key) throw new Error('Invalid pairing');
    const derived = keys(key.secret);
    const payload = open(derived.request, envelope, 'aspen-request-v1');
    if (
      !Number.isFinite(payload.time) ||
      Math.abs(Date.now() - payload.time) > 120000
    )
      throw new Error('Expired request');
    if (key.contextOnly && (payload.path !== '/v1/context' || payload.method !== 'POST')) throw new Error('Context-only credential');
    if (key.enrollmentOnly && (payload.path !== '/v1/enroll' || payload.method !== 'POST')) throw new Error('Setup-only credential');
    const nonceId = envelope.id + ':' + envelope.nonce;
    const store = require('./store');
    for (const [id, until] of Object.entries(store.get('secureReplay') || {})) if (until > Date.now()) seen.set(id, until);
    for (const [id, until] of seen) if (until < Date.now()) seen.delete(id);
    if (seen.has(nonceId) || seen.size > 10000)
      throw new Error('Replay or capacity limit');
    seen.set(nonceId, Date.now() + 240000);
    store.set('secureReplay', Object.fromEntries(seen));
    if (
      !['GET', 'POST', 'DELETE'].includes(payload.method) ||
      !/^\/(v1\/(agent|models|world-model|vault|context|household|enroll|chat\/completions)|missions(?:\/stop)?|publish-artifact)$/.test(
        payload.path
      )
    )
      throw new Error('Unsupported encrypted route');
    const inner = Readable.from(
      payload.body == null ? [] : [Buffer.from(JSON.stringify(payload.body))]
    );
    Object.assign(inner, {
      aspenSecure: true,
      method: payload.method,
      url: payload.path,
      headers: {
        authorization: `Bearer ${key.secret}`,
        'content-type': 'application/json'
      },
      socket: req.socket
    });
    let sequence = 0;
    let headerSent = false;
    const send = (value) =>
      res.write(
        JSON.stringify(
          seal(
            derived.response,
            { sequence: sequence++, ...value },
            envelope.nonce
          )
        ) + '\n'
      );
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-store'
    });
    const out = new Writable({
      write(chunk, _encoding, callback) {
        if (!headerSent) {
          headerSent = true;
          send({ status: out.statusCode || 200 });
        }
        if (send({ bytes: chunk.toString('base64') })) callback();
        else res.once('drain', callback);
      },
      final(callback) {
        send({ end: true, status: out.statusCode || 200 });
        res.end();
        callback();
      }
    });
    out.setHeader = () => {};
    out.writeHead = (status) => {
      out.statusCode = status;
      out.headersSent = true;
      return out;
    };
    out.on('error', () => res.destroy());
    res.on('close', () => {
      inner.destroy();
      out.destroy();
    });
    await dispatch(inner, out);
  } catch {
    if (!res.headersSent)
      res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(
      '{"error":"Secure connection failed. Check the pairing and device clock."}'
    );
  }
}
module.exports = { keys, seal, open, handle };
