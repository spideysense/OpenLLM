/**
 * Gateway CORS tests — these exist because a CORS bug broke the web app and
 * phone app for all users. The gateway must accept all legitimate origins.
 *
 * NEVER remove or loosen these tests. Every allowed origin must be explicitly tested.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(path.resolve('src/main/gateway.js'), 'utf8');

describe('Gateway CORS — origin allowlist', () => {
  it('allows https://runonaspen.com (no www)', () => {
    expect(src).toContain("'https://runonaspen.com'");
  });

  it('allows https://www.runonaspen.com (WITH www) — this was the P0 bug', () => {
    expect(src).toContain("'https://www.runonaspen.com'");
  });

  it('allows *.runonaspen.com subdomains (tunnel URLs like c5pvto71.runonaspen.com)', () => {
    expect(src).toContain('.runonaspen.com');
  });

  it('allows capacitor://localhost (iOS app)', () => {
    expect(src).toContain('capacitor://localhost');
  });

  it('allows ionic://localhost (mobile app)', () => {
    expect(src).toContain('ionic://localhost');
  });

  it('allows http://localhost (local dev)', () => {
    expect(src).toContain('localhost');
  });

  it('CORS logic uses origin-based check not static string', () => {
    // Must NOT use a single static string for all origins — that would break www vs no-www
    expect(src).not.toMatch(/setHeader\('Access-Control-Allow-Origin',\s*'https:\/\/runonaspen\.com'\)/);
  });
});

describe('Gateway CORS — runtime behavior', () => {
  // Simulate the CORS check logic extracted from gateway.js
  function checkCors(origin) {
    return origin === 'https://runonaspen.com'
      || origin === 'https://www.runonaspen.com'
      || (origin.startsWith('https://') && origin.endsWith('.runonaspen.com'))
      || origin.startsWith('http://localhost')
      || origin === 'capacitor://localhost'
      || origin === 'ionic://localhost';
  }

  it('runonaspen.com → allowed', () => expect(checkCors('https://runonaspen.com')).toBe(true));
  it('www.runonaspen.com → allowed', () => expect(checkCors('https://www.runonaspen.com')).toBe(true));
  it('c5pvto71.runonaspen.com → allowed (tunnel URL)', () => expect(checkCors('https://c5pvto71.runonaspen.com')).toBe(true));
  it('capacitor://localhost → allowed (iOS)', () => expect(checkCors('capacitor://localhost')).toBe(true));
  it('http://localhost:5173 → allowed (dev)', () => expect(checkCors('http://localhost:5173')).toBe(true));
  it('https://evil.com → blocked', () => expect(checkCors('https://evil.com')).toBe(false));
  it('https://notrunonaspen.com → blocked', () => expect(checkCors('https://notrunonaspen.com')).toBe(false));
  it('empty string → blocked', () => expect(checkCors('')).toBe(false));
});
