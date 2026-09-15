// @vitest-environment node
import { describe, it, expect } from 'vitest';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { TextEncoder, TextDecoder } from 'node:util';
import { secureFetch } from '../../shared/secure-fetch.js';
const require = createRequire(import.meta.url);
const secret = 'sk-aspen-' + crypto.randomBytes(24).toString('base64url');
function channel(keys) {
  const module = { exports: {} };
  const data = {}; const store = { get: k => data[k], set: (k,v) => { data[k] = v; } };
  vm.runInNewContext(fs.readFileSync('src/main/secure-channel.js', 'utf8'), { module, Buffer, console,
    require: id => id === './apikeys' ? { listKeys: () => keys } : id === './store' ? store : require(id) });
  return module.exports;
}
async function serverFixture(dispatch, test) {
  const keys = [{ secret, owner: false }]; const c = channel(keys); let wire = '';
  const server = http.createServer((req, res) => { req.on('data', b => { wire += b.toString(); }); c.handle(req, res, dispatch); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await test({ base: `http://127.0.0.1:${server.address().port}`, keys, c, wire: () => wire }); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
const adapter = async key => {
  const k = channel([]).keys(key); return { id: k.id,
    seal: value => channel([]).seal(k.request, value, 'aspen-request-v1'),
    open: (value, nonce) => channel([]).open(k.response, value, nonce) };
};

describe('encrypted device transport', () => {
  it('interoperates with browser WebCrypto and carries split Unicode SSE without plaintext credentials', async () => {
    const previous = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', { value: crypto.webcrypto, configurable: true });
    try {
      await serverFixture((req, res) => {
        expect(req.headers.authorization).toBe(`Bearer ${secret}`); let body = '';
        req.on('data', b => { body += b; }); req.on('end', () => {
          expect(JSON.parse(body).messages[0].content).toBe('private household fact');
          res.writeHead(200); const bytes = Buffer.from('data: 家🌲\n\n');
          for (const b of bytes) res.write(Buffer.of(b)); res.end();
        });
      }, async ({ base, wire }) => {
        const response = await secureFetch(base, secret, '/v1/agent', { method: 'POST', body: { messages: [{ content: 'private household fact' }] } });
        expect(await response.text()).toBe('data: 家🌲\n\n');
        expect(wire()).not.toContain(secret); expect(wire()).not.toContain('private household fact');
      });
    } finally { Object.defineProperty(globalThis, 'crypto', { value: previous, configurable: true }); }
  });
  it('preserves HTTP error statuses inside the encrypted response', async () => {
    await serverFixture((_req, res) => { res.writeHead(403); res.end('{"error":"Owner required"}'); }, async ({ base }) => {
      const response = await secureFetch(base, secret, '/missions', { cryptoAdapter: adapter });
      expect(response.status).toBe(403); expect(await response.json()).toEqual({ error: 'Owner required' });
    });
  });
  it('rejects replay, tampering, expired clocks, unknown keys, and revoked keys', async () => {
    let dispatched = 0;
    await serverFixture((_req, res) => { dispatched++; res.end('ok'); }, async ({ base, c, keys }) => {
      const k = c.keys(secret);
      const envelope = { id: k.id, ...c.seal(k.request, { method: 'GET', path: '/v1/models', time: Date.now() }, 'aspen-request-v1') };
      const post = value => fetch(base, { method: 'POST', body: JSON.stringify(value) });
      const first = await post(envelope); await first.text(); expect(first.status).toBe(200);
      expect((await post(envelope)).status).toBe(401);
      expect((await post({ ...envelope, nonce: envelope.nonce + '\n' })).status).toBe(401);
      expect((await post({ ...envelope, data: Buffer.from('tampered').toString('base64') })).status).toBe(401);
      expect((await post({ id: k.id, ...c.seal(k.request, { method: 'GET', path: '/v1/models', time: 1 }, 'aspen-request-v1') })).status).toBe(401);
      expect((await post({ ...envelope, id: 'unknown' })).status).toBe(401);
      keys.length = 0;
      await expect(secureFetch(base, secret, '/v1/models', { cryptoAdapter: adapter })).rejects.toThrow(/pairing/);
      expect(dispatched).toBe(1);
    });
  });
  it('propagates client cancellation to the running handler', async () => {
    let closedResolve; const closed = new Promise(resolve => { closedResolve = resolve; });
    await serverFixture((_req, res) => { res.on('close', closedResolve); res.write('started'); }, async ({ base }) => {
      const controller = new AbortController();
      const response = await secureFetch(base, secret, '/v1/agent', { signal: controller.signal, cryptoAdapter: adapter });
      controller.abort(); await expect(response.text()).rejects.toBeTruthy(); await closed;
    });
  });
  it('rejects reordered or truncated response frames', async () => {
    for (const reorder of [true, false]) {
      const fakeFetch = async (_url, request) => {
        const envelope = JSON.parse(request.body), c = channel([]), k = c.keys(secret);
        const frames = [c.seal(k.response, { sequence: 0, status: 200 }, envelope.nonce)];
        if (reorder) frames.push(c.seal(k.response, { sequence: 2, bytes: 'aGk=' }, envelope.nonce));
        return new Response(frames.map(f => JSON.stringify(f) + '\n').join(''));
      };
      const response = await secureFetch('https://example.test', secret, '/v1/agent', { cryptoAdapter: adapter, fetchImpl: fakeFetch });
      await expect(response.text()).rejects.toThrow(reorder ? /sequence/ : /interrupted/);
    }
  });
});
