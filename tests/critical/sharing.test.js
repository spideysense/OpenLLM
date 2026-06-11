import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

process.env.KV_REST_API_URL = 'https://fake-kv.upstash.io';
process.env.KV_REST_API_TOKEN = 'fake-token';

describe('Community Sharing — app side', () => {
  it('Home.jsx sends saved + exchanges to community-savings', () => {
    const src = fs.readFileSync(path.resolve('src/renderer/pages/Home.jsx'), 'utf8');
    expect(src).toContain('community-savings');
    expect(src).toContain('saved');
    expect(src).toContain('exchanges');
  });

  it('website reads from same community-savings endpoint', () => {
    const src = fs.readFileSync(path.resolve('site/index.html'), 'utf8');
    expect(src).toContain('community-savings');
  });

  it('API has no IP tracking or rate limiting', () => {
    const src = fs.readFileSync(path.resolve('api/community-savings.js'), 'utf8');
    expect(src).not.toContain('x-forwarded-for');
    expect(src).not.toContain('ratelimit');
    expect(src).not.toContain('86400');
  });
});

// POST/GET roundtrip — separate describe so handler import is at top level
let kvStore = {};
const kvFetch = vi.fn(async (url) => {
  const u = String(url);
  if (u.includes('/get/')) {
    const key = decodeURIComponent(u.split('/get/')[1].split('?')[0]);
    return { json: async () => ({ result: kvStore[key] ?? null }) };
  }
  if (u.includes('/set/')) {
    const after = u.split('/set/')[1];
    const slash = after.indexOf('/');
    if (slash !== -1) kvStore[decodeURIComponent(after.slice(0, slash))] = decodeURIComponent(after.slice(slash + 1));
    return { json: async () => ({ result: 'OK' }) };
  }
  return { json: async () => ({}) };
});

const { default: handler } = await import('../../api/community-savings.js');
const req = (method, body={}) => ({ method, body, headers: {} });
const res = () => {
  const r = { _status: 200, _body: null };
  r.status = s => { r._status = s; return r; };
  r.json = b => { r._body = b; return r; };
  r.end = () => r; r.setHeader = () => r;
  return r;
};

describe('Community Savings API — POST/GET roundtrip', () => {
  beforeEach(() => { kvStore = {}; global.fetch = kvFetch; vi.clearAllMocks(); global.fetch = kvFetch; });

  it('share flow: POST succeeds and GET reflects it', async () => {
    const r1 = res();
    await handler(req('POST', { saved: 1626.06, exchanges: 42791 }), r1);
    expect(r1._status).toBe(200);
    expect(r1._body.ok).toBe(true);

    const r2 = res();
    await handler(req('GET'), r2);
    expect(r2._body.total).toBeCloseTo(1626.06, 1);
    expect(r2._body.totalExchanges).toBe(42791);
  });

  it('can share 5x without any rejection', async () => {
    for (let i = 0; i < 5; i++) {
      const r = res();
      await handler(req('POST', { saved: 100, exchanges: 1000 }), r);
      expect(r._status).toBe(200);
    }
  });
});
