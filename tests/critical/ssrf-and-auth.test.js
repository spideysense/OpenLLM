/**
 * Security regression tests — added after the 2026-06-12 review.
 *
 * Each test guards a specific finding from that review:
 *   1. SSRF: fetch_url / web_search must not reach internal addresses. Any valid
 *      key (incl. low-trust family/guest keys) can call fetch_url over the
 *      public tunnel — without a guard it could hit the cloud metadata endpoint,
 *      the loopback interface, or the LAN and return internal data to a remote
 *      caller.
 *   2. Fail-closed auth: revoking the last API key must NOT drop the gateway into
 *      open mode (validateKey returns true for any token when the store is empty).
 *   3. debug endpoint: must be password-gated and must not leak the tunnel base
 *      URL to anonymous callers.
 *   4. Rate-limit / brute-force key: must prefer cf-connecting-ip so a rotated
 *      X-Forwarded-For can't defeat the auth-fail lockout.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const tools = await import('../../src/main/tools.js');
const apikeys = await import('../../src/main/apikeys.js');
// apikeys.js does `require('./store')`. To clear state from this ESM test we must
// touch the SAME module instance — an `import()` of store.js resolves to a
// separate instance under vitest (the dual-instance gotcha documented in
// per-key-memory.test.js), so we require it the same way apikeys does.
const store = require('../../src/main/store.js');

// ─────────────────────────────────────────────────────────────────────────────
// 1. SSRF guard
// ─────────────────────────────────────────────────────────────────────────────
describe('SSRF guard — blocked hosts', () => {
  const blocked = [
    '169.254.169.254',          // AWS/GCP/Azure metadata
    'metadata.google.internal', // GCP metadata hostname
    '127.0.0.1', '127.5.5.5',   // loopback
    '0.0.0.0',                  // this-host
    '10.1.2.3',                 // private A
    '172.16.0.1', '172.31.9.9', // private B
    '192.168.1.1',              // private C
    '100.64.0.1',               // CGNAT
    'localhost', 'foo.localhost',
    'printer.local', 'svc.internal',
    '::1',                      // IPv6 loopback
    'fd00::1',                  // IPv6 unique-local
    'fe80::1',                  // IPv6 link-local
    '',                         // empty
  ];
  for (const h of blocked) {
    it(`blocks ${h || '(empty)'}`, () => {
      expect(tools.hostIsBlocked(h)).toBe(true);
    });
  }
});

describe('SSRF guard — allowed public hosts', () => {
  const allowed = ['8.8.8.8', '1.1.1.1', 'example.com', 'html.duckduckgo.com', '172.32.0.1', '100.128.0.1'];
  for (const h of allowed) {
    it(`allows ${h}`, () => {
      expect(tools.hostIsBlocked(h)).toBe(false);
    });
  }
});

describe('SSRF guard — ipIsBlocked covers v4-mapped IPv6', () => {
  it('blocks ::ffff:127.0.0.1 and ::ffff:169.254.169.254', () => {
    expect(tools.ipIsBlocked('::ffff:127.0.0.1')).toBe(true);
    expect(tools.ipIsBlocked('::ffff:169.254.169.254')).toBe(true);
  });
  it('allows ::ffff:8.8.8.8', () => {
    expect(tools.ipIsBlocked('::ffff:8.8.8.8')).toBe(false);
  });
  it('blocks unparseable input', () => {
    expect(tools.ipIsBlocked('not-an-ip')).toBe(true);
    expect(tools.ipIsBlocked('')).toBe(true);
  });
});

describe('SSRF guard — runFetchUrl refuses internal targets (no network)', () => {
  it('refuses the cloud metadata endpoint', async () => {
    const r = await tools.runFetchUrl({ url: 'http://169.254.169.254/latest/meta-data/' });
    expect(r).toMatch(/blocked|Could not fetch/i);
  });
  it('refuses loopback', async () => {
    const r = await tools.runFetchUrl({ url: 'http://127.0.0.1:11434/api/tags' });
    expect(r).toMatch(/blocked|Could not fetch/i);
  });
  it('refuses a private LAN address', async () => {
    const r = await tools.runFetchUrl({ url: 'http://192.168.1.1/' });
    expect(r).toMatch(/blocked|Could not fetch/i);
  });
});

describe('SSRF guard — source wiring', () => {
  const src = fs.readFileSync(path.resolve('src/main/tools.js'), 'utf8');
  it('fetchText validates the host before connecting', () => {
    expect(src).toMatch(/hostIsBlocked\(parsed\.hostname\)/);
  });
  it('fetchText pins a validating DNS lookup (rebind protection)', () => {
    expect(src).toMatch(/lookup:\s*safeLookup/);
  });
  it('rejects non-http(s) protocols', () => {
    expect(src).toMatch(/unsupported protocol/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Fail-closed auth
// ─────────────────────────────────────────────────────────────────────────────
describe('Auth fail-closed — revoking the last key never opens the gateway', () => {
  beforeEach(() => { store.set('apikeys', []); });

  it('revoking the only key regenerates a Default owner key (store never empty)', () => {
    const k = apikeys.createKey('Default', { owner: true });
    expect(apikeys.listKeys()).toHaveLength(1);

    const result = apikeys.revokeKey(k.id);
    expect(result.regenerated).toBe(true);
    expect(result.newKey).toBeTruthy();
    expect(result.newKey.owner).toBe(true);

    const after = apikeys.listKeys();
    expect(after).toHaveLength(1);          // never empty
    expect(after[0].secret).not.toBe(k.secret); // genuinely new key
  });

  it('the regenerated state is NOT open mode (a wrong token is rejected)', () => {
    const k = apikeys.createKey('Default', { owner: true });
    apikeys.revokeKey(k.id);
    // Store is non-empty, so an arbitrary token must fail (open mode would pass it).
    expect(apikeys.validateKey('sk-aspen-not-a-real-key')).toBe(false);
  });

  it('revoking a non-last key leaves the rest and does not regenerate', () => {
    const a = apikeys.createKey('Default', { owner: true });
    const b = apikeys.createKey('Ashini', { memory: true });
    const result = apikeys.revokeKey(b.id);
    expect(result.regenerated).toBeFalsy();
    const after = apikeys.listKeys();
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(a.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Debug endpoint gating
// ─────────────────────────────────────────────────────────────────────────────
describe('Debug endpoint is gated and does not leak the base URL', () => {
  const src = fs.readFileSync(path.resolve('api/debug.js'), 'utf8');
  it('requires ADMIN_PASSWORD', () => {
    expect(src).toMatch(/ADMIN_PASSWORD/);
    expect(src).toMatch(/401|Unauthorized/);
  });
  it('redacts the raw tunnel base URL', () => {
    expect(src).toMatch(/redactUrl/);
    expect(src).not.toMatch(/baseUrl:\s*baseUrl\s*\|\|/); // old unredacted echo gone
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Reasoning-trail parity (web ↔ mobile)
//    The live reasoning/tool-step trail ships on the two surfaces that share the
//    gateway SSE path (web + mobile). The "forgetting one surface" footgun is the
//    most common bug in this codebase, so guard that neither drops the signal.
//    (Desktop uses the IPC→agent.js path and renders reasoning differently — it
//    is intentionally excluded here.)
// ─────────────────────────────────────────────────────────────────────────────
describe('Reasoning trail — web and mobile stay in sync', () => {
  const web = fs.readFileSync(path.resolve('site/app/index.html'), 'utf8');
  const mobile = fs.readFileSync(path.resolve('mobile/www/index.html'), 'utf8');
  it('web app consumes the aspen_status / aspen_tool SSE signals', () => {
    expect(web).toMatch(/aspen_status/);
    expect(web).toMatch(/aspen_tool/);
  });
  it('mobile app consumes the aspen_status / aspen_tool SSE signals', () => {
    expect(mobile).toMatch(/aspen_status/);
    expect(mobile).toMatch(/aspen_tool/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Rate-limit / lockout IP source
// ─────────────────────────────────────────────────────────────────────────────
describe('Rate-limit key prefers a non-spoofable client IP', () => {
  const src = fs.readFileSync(path.resolve('src/main/gateway.js'), 'utf8');
  it('uses cf-connecting-ip before x-forwarded-for', () => {
    const idxCf = src.indexOf('cf-connecting-ip');
    const idxXff = src.indexOf('x-forwarded-for');
    expect(idxCf).toBeGreaterThan(-1);
    expect(idxCf).toBeLessThan(idxXff); // cf-connecting-ip checked first
  });
});
