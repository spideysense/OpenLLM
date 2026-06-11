import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.KV_REST_API_URL = 'https://fake-kv.upstash.io';
process.env.KV_REST_API_TOKEN = 'fake-token';

// Mock: GET /get/<key>  and  POST /set/<key> with JSON body
let kvStore = {};
function makeFetch() {
  return vi.fn(async (url, opts) => {
    const u = String(url);
    if (u.includes('/get/')) {
      const key = decodeURIComponent(u.split('/get/')[1].split('?')[0]);
      return { json: async () => ({ result: kvStore[key] ?? null }) };
    }
    if (u.includes('/set/') && opts?.method === 'POST') {
      const key = decodeURIComponent(u.split('/set/')[1].split('?')[0]);
      // Upstash stores the inner value (one JSON parse from what we sent)
      try { kvStore[key] = JSON.parse(opts.body); } catch { kvStore[key] = opts.body; }
      return { json: async () => ({ result: 'OK' }) };
    }
    return { json: async () => ({}) };
  });
}

function req(method, body = {}) { return { method, body, headers: {} }; }
function res() {
  const r = { _status: 200, _body: null };
  r.status = s => { r._status = s; return r; };
  r.json = b => { r._body = b; return r; };
  r.end = () => r; r.setHeader = () => r;
  return r;
}

const { default: handler } = await import('../../api/community-savings.js');

describe('Community Savings', () => {
  beforeEach(() => { kvStore = {}; global.fetch = makeFetch(); });

  it('GET returns zeros with empty store', async () => {
    const r = res(); await handler(req('GET'), r);
    expect(r._status).toBe(200);
    expect(r._body).toMatchObject({ total: 0, totalExchanges: 0, count: 0 });
  });

  it('POST then GET reflects saved values', async () => {
    await handler(req('POST', { saved: 12.50, exchanges: 330 }), res());
    const r = res(); await handler(req('GET'), r);
    expect(r._body.total).toBe(12.50);
    expect(r._body.totalExchanges).toBe(330);
    expect(r._body.count).toBe(1);
  });

  it('accumulates across multiple POSTs', async () => {
    await handler(req('POST', { saved: 10, exchanges: 100 }), res());
    await handler(req('POST', { saved: 20, exchanges: 200 }), res());
    const r = res(); await handler(req('GET'), r);
    expect(r._body.total).toBeCloseTo(30, 2);
    expect(r._body.count).toBe(2);
  });

  it('NO rate limiting — same IP can POST 10x', async () => {
    for (let i = 0; i < 10; i++) {
      const r = res();
      await handler(req('POST', { saved: 100, exchanges: 1000 }), r);
      expect(r._status).toBe(200);
      expect(r._body.ok).toBe(true);
    }
    const r = res(); await handler(req('GET'), r);
    expect(r._body.count).toBe(10);
  });

  it('accepts large marketing numbers', async () => {
    const r = res();
    await handler(req('POST', { saved: 1626.06, exchanges: 42791 }), r);
    expect(r._status).toBe(200);
    expect(r._body.ok).toBe(true);
  });

  it('rejects non-number fields', async () => {
    const r1 = res(); await handler(req('POST', { saved: 'lots', exchanges: 100 }), r1);
    expect(r1._status).toBe(400);
    const r2 = res(); await handler(req('POST', {}), r2);
    expect(r2._status).toBe(400);
  });

  it('recent feed caps at 50, total count keeps accumulating', async () => {
    for (let i = 0; i < 60; i++) await handler(req('POST', { saved: 1, exchanges: 10 }), res());
    const r = res(); await handler(req('GET'), r);
    expect(r._body.recent.length).toBeLessThanOrEqual(50);
    expect(r._body.count).toBe(60);
  });
});
