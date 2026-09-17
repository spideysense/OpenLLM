/**
 * Regression tests — one test per bug shipped.
 * These exist so the same bug cannot ship twice.
 * DO NOT DELETE. Add new ones whenever a bug reaches production.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'node:child_process';

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

describe('Metrics accuracy (admin dashboard)', () => {
  it('downloads count only .dmg and .exe (not update machinery)', () => {
    const src = fs.readFileSync(path.resolve('api/admin-stats.js'), 'utf8');
    expect(src).toContain(".endsWith('.dmg')");
    expect(src).toContain(".endsWith('.exe')");
    // Must NOT blindly sum all assets anymore
    expect(src).not.toMatch(/for \(const a of rel\.assets \|\| \[\]\) relTotal \+= a\.download_count/);
  });

  it('site actually calls /api/visits on load', () => {
    const src = fs.readFileSync(path.resolve('site/index.html'), 'utf8');
    expect(src).toContain('/api/visits');
    expect(src).toContain('Count this visit');
  });

  it('visit seed is 2000 (real visits add on top)', () => {
    const visitsSrc = fs.readFileSync(path.resolve('api/visits.js'), 'utf8');
    const adminSrc = fs.readFileSync(path.resolve('api/admin-stats.js'), 'utf8');
    expect(visitsSrc).toContain("'2000'");
    expect(adminSrc).toContain("'2000'");
    // Real counter must still be added on top of the seed (not hardcoded)
    expect(visitsSrc).toContain('data.result');
    expect(adminSrc).toContain('aspen:visits');
  });
});


describe('BUG: visitor attribution could inject HTML into the admin dashboard', () => {
  it('renders attacker-controlled source, release and note values as text', () => {
    const html = fs.readFileSync(path.resolve('site/admin/index.html'), 'utf8');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const script = doc.querySelector('script:not([src])').textContent;
    const render = new Function('document', 'localStorage', script + '\nreturn render;')(doc, { removeItem() {} });
    const attack = '<img src=x onerror="alert(1)">';
    render({ downloads: { total: 1, byRelease: [{tag: attack, downloads: 1}] }, sources: [{source: attack, count: 1}], dlSources: [{source: attack, platform: attack, count: 1}], notes: [attack] });
    for (const id of ['sources', 'dlsources', 'releases', 'notes']) {
      expect(doc.getElementById(id).textContent).toContain(attack);
      expect(doc.getElementById(id).querySelector('img')).toBeNull();
    }
    expect(script).not.toContain("localStorage.setItem('admin_pw'");
  });
});


describe('BUG: deployed waitlist handlers could not load their ESM-only helper', () => {
  it('loads the shared helper in Node without require-of-ESM support', () => {
    const result = execFileSync(process.execPath, ['--no-experimental-require-module', '-e', "const w = require('./src/cloud/waitlist.cjs'); if (typeof w.join !== 'function' || typeof w.list !== 'function') process.exit(1);"], {cwd:process.cwd(),encoding:'utf8'});
    expect(result).toBe('');
    for (const file of ['api/waitlist.js', 'api/admin-stats.js']) {
      expect(fs.readFileSync(file,'utf8')).toContain("require('../src/cloud/waitlist.cjs')");
    }
  });
});

describe('BUG: household chat remained visible after switching family accounts', () => {
  it('clears the previous conversation and ignores its delayed reply after sign-in changes', async () => {
    const {JSDOM} = await import('jsdom');
    const dom = new JSDOM('<div id="app"></div><dialog id="dialog"></dialog><div id="toast"></div>', {url:'http://aspen.test/',runScripts:'outside-only'});
    const w=dom.window;w.scrollTo=()=>{};w.setInterval=()=>0;
    let member='Alex', oldReply;
    const snapshot=()=>({privacy:{inference:'local-only'},household:{name:'Home'},me:{id:member,name:member,role:'owner'},members:[],rooms:[],tasks:[],memories:[],devices:[],apps:[{id:'butler',name:'Butler',installed:true}],clients:[],connections:{},events:[]});
    w.fetch=async(url,options={})=>{
      const route=url.split('/').pop();
      if(route==='chat')return new Promise(resolve=>{oldReply=()=>resolve({ok:true,json:async()=>({text:'Alex private late reply'})});});
      if(route==='login')member='Sam';
      return {ok:true,json:async()=>route==='status'?{setup:true}:route==='state'?snapshot():{ok:true}};
    };
    const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
    const source=fs.readFileSync(path.resolve('site/home/home.js'),'utf8').replace("import { qrSvg } from './qr.js';","const qrSvg=()=>'';");
    w.eval(source+"\nwindow.showAsk=()=>{view='ask';render();};");await flush();
    w.document.querySelector('#ask-form input').value='Alex private question';
    w.document.querySelector('#ask-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await flush();
    w.document.querySelector('[data-view="settings"]').click();await flush();
    w.document.querySelector('[data-action="logout"]').click();await flush();
    const login=w.document.querySelector('#account-form');login.querySelector('[name=name]').value='Sam';login.querySelector('[name=password]').value='a private password';login.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await flush();
    oldReply();await flush();
    w.showAsk();
    expect(w.document.body.textContent).not.toContain('Alex private question');
    expect(w.document.body.textContent).not.toContain('Alex private late reply');
    expect(w.document.body.textContent).toContain('Ask Aspen');
    dom.window.close();
  });
});
