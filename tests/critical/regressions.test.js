/**
 * Regression tests — one test per bug shipped.
 * These exist so the same bug cannot ship twice.
 * DO NOT DELETE. Add new ones whenever a bug reaches production.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const gateway  = fs.readFileSync(path.resolve('src/main/gateway.js'), 'utf8');
const release  = fs.readFileSync(path.resolve('scripts/release-mac.js'), 'utf8');
const savings  = fs.readFileSync(path.resolve('api/community-savings.js'), 'utf8');
const tunnel   = fs.readFileSync(path.resolve('src/main/tunnel.js'), 'utf8');
const pkg      = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));

describe('BUG: www.runonaspen.com CORS blocked (broke web + phone app for all users)', () => {
  it('gateway allows www.runonaspen.com origin', () => {
    expect(gateway).toContain('www.runonaspen.com');
  });
  it('gateway allows *.runonaspen.com subdomains', () => {
    expect(gateway).toContain('.runonaspen.com');
  });
  it('gateway does NOT use a single hardcoded origin for all requests', () => {
    expect(gateway).not.toMatch(/Allow-Origin',\s*'https:\/\/runonaspen\.com'\)/);
  });
});

describe('BUG: community savings rate-limited updates (user savings never reflected on site)', () => {
  it('savings API has no IP extraction', () => {
    expect(savings).not.toContain('x-forwarded-for');
  });
  it('savings API has no rate limit window', () => {
    expect(savings).not.toContain('86400');
    expect(savings).not.toContain('ratelimit');
  });
  it('savings API has no per-IP KV keys', () => {
    expect(savings).not.toMatch(/entry:\$\{ip\}|ratelimit:\$\{ip\}/);
  });
});

describe('BUG: release script version mismatch (built v0.4.34 when user ran 0.4.35)', () => {
  it('release script reads version from CLI arg (process.argv[2])', () => {
    expect(release).toContain('process.argv[2]');
  });
  it('release script commits version before building', () => {
    expect(release).toContain('Committing version bump');
  });
  it('release script pushes version commit before Windows workflow sees it', () => {
    const commitIdx = release.indexOf('git commit');
    const windowsIdx = release.indexOf('release-windows');
    expect(commitIdx).toBeGreaterThan(0);
    expect(windowsIdx).toBeGreaterThan(0);
    expect(commitIdx).toBeLessThan(windowsIdx);
  });
});

describe('BUG: Windows workflow created rogue v0.4.6 release, broke auto-updates for all users', () => {
  it('package.json version is not stuck at 0.4.6', () => {
    expect(pkg.version).not.toBe('0.4.6');
    const [, minor] = pkg.version.split('.').map(Number);
    expect(minor).toBeGreaterThanOrEqual(4);
  });
  it('release script uses --no-git-tag-version (no stray git tags)', () => {
    expect(release).toContain('no-git-tag-version');
  });
  it('release script allows-same-version (idempotent re-runs)', () => {
    expect(release).toContain('allow-same-version');
  });
});

describe('BUG: robotjs in dependencies broke all Vercel deploys', () => {
  it('robotjs is in optionalDependencies not dependencies', () => {
    const deps = pkg.dependencies || {};
    const optional = pkg.optionalDependencies || {};
    expect(deps['robotjs']).toBeUndefined();
    if (optional['robotjs']) {
      expect(optional['robotjs']).toBeTruthy();
    }
    // Either not present at all, or in optional — never in required deps
  });
});

describe('BUG: git pull blocked by package.json changes (stale code in every build)', () => {
  it('release script discards package.json before pull', () => {
    expect(release).toContain('git checkout -- package-lock.json package.json');
  });
  it('release script does git pull', () => {
    expect(release).toContain('git pull');
  });
});

describe('BUG: DMG uploaded before stapling ("Aspen is damaged" for users)', () => {
  it('xcrun stapler validate runs before upload', () => {
    const validateIdx = release.indexOf('xcrun stapler validate');
    const uploadIdx = release.indexOf('// 4. Upload');
    expect(validateIdx).toBeGreaterThan(0);
    expect(validateIdx).toBeLessThan(uploadIdx);
  });
});

describe('BUG: tunnel stable URL not persisted (users lost tunnel on restart)', () => {
  it('tunnel stores URL in electron-store', () => {
    expect(tunnel).toContain("store.set");
    expect(tunnel).toContain("tunnelUrl");
  });
  it('tunnel restores URL from store on restart', () => {
    expect(tunnel).toContain("store.get('tunnelUrl')");
  });
});

describe('BUG: send button in web/mobile sent previous message instead of current input', () => {
  it('web app send button uses arrow function wrapper (not direct sendMessage reference)', () => {
    const src = fs.readFileSync(path.resolve('site/app/index.html'), 'utf8');
    // Must be ()=>sendMessage() not sendMessage — direct ref passes MouseEvent as autoRespond arg
    expect(src).toContain("addEventListener('click',()=>sendMessage())");
    expect(src).not.toMatch(/sendBtn\.addEventListener\('click',\s*sendMessage\s*\)/);
  });

  it('mobile app send button uses arrow function wrapper', () => {
    const src = fs.readFileSync(path.resolve('mobile/www/index.html'), 'utf8');
    expect(src).toContain("addEventListener('click',()=>sendMessage())");
    expect(src).not.toMatch(/sendBtn\.addEventListener\('click',\s*sendMessage\s*\)/);
  });
});

describe('BUG: Computer Use onboarding modal appeared every launch (key blocked by store allowlist)', () => {
  it('computerUseOnboarded is in the store allowlist', () => {
    const src = fs.readFileSync(path.resolve('src/main/index.js'), 'utf8');
    expect(src).toContain('computerUseOnboarded');
    expect(src).toMatch(/STORE_ALLOWLIST[\s\S]*computerUseOnboarded/);
  });
});

describe('BUG: community savings 500 (wrong Upstash SET format)', () => {
  it('kvSet uses POST body not URL-path (handles long JSON values)', () => {
    const src = fs.readFileSync(path.resolve('api/community-savings.js'), 'utf8');
    expect(src).toContain("method: 'POST'");
    expect(src).toContain('Content-Type');
    // Must NOT use URL-path format (breaks with long JSON)
    expect(src).not.toMatch(/\/set\/.*encodeURIComponent\(key\).*encodeURIComponent\(value\)/);
  });
});

describe('BUG: gateway.js SyntaxError — for await in non-async callback (crashed main process)', () => {
  it('gateway.js has no bare for-await outside an async function', () => {
    const src = fs.readFileSync(path.resolve('src/main/gateway.js'), 'utf8');
    // Every for await must be inside an async IIFE: (async () => { for await ... })()
    // A bare "for await" at the non-async req.on('end', () => {}) level is a SyntaxError
    const forAwaits = [...src.matchAll(/for\s+await\s*\(/g)];
    for (const match of forAwaits) {
      // Find the surrounding context — should have async before the for await
      const before = src.slice(Math.max(0, match.index - 200), match.index);
      expect(before).toMatch(/async/);
    }
  });
});

describe('BUG: 307 redirect drops POST body (non-www → www on api calls)', () => {
  it('desktop app posts savings to www.runonaspen.com (not non-www)', () => {
    const src = fs.readFileSync(path.resolve('src/renderer/pages/Home.jsx'), 'utf8');
    // Must use www to avoid the 307 redirect that drops the POST body
    expect(src).toContain('www.runonaspen.com/api/community-savings');
    expect(src).not.toMatch(/fetch\('https:\/\/runonaspen\.com\/api\/community-savings'/);
  });

  it('mobile app API base uses www.runonaspen.com', () => {
    const src = fs.readFileSync(path.resolve('mobile/www/index.html'), 'utf8');
    // apiBase() for native must return www to avoid POST-body-dropping redirects
    expect(src).not.toMatch(/return 'https:\/\/runonaspen\.com';/);
  });

  it('no surface POSTs to bare runonaspen.com/api (would 307 and lose body)', () => {
    for (const f of ['src/renderer/pages/Home.jsx', 'mobile/www/index.html']) {
      const src = fs.readFileSync(path.resolve(f), 'utf8');
      // POST calls must go to www. or relative /api — never bare https://runonaspen.com/api
      const badPosts = [...src.matchAll(/fetch\('https:\/\/runonaspen\.com\/api[^']*'/g)];
      expect(badPosts.length).toBe(0);
    }
  });
});
