#!/usr/bin/env node
/**
 * Aspen mac release — correct ordering.
 *
 * The bug this fixes: `electron-builder --publish always` uploads the DMG to
 * GitHub DURING the build, BEFORE the afterAllArtifactBuild staple hook runs.
 * So GitHub gets an un-stapled DMG → users see "Aspen is damaged".
 *
 * This script enforces the right order:
 *   1. Build the app + DMG with NO publish (electron-builder --publish never).
 *      The afterAllArtifactBuild hook notarizes + staples the DMG locally.
 *   2. THEN upload the already-stapled artifacts to a fresh GitHub release.
 *
 * Usage:  npm run release:mac -- 0.4.38
 *
 * Credentials: stored in ~/.aspen-release-env (auto-created on first run).
 * You never need to paste export lines again.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');

// ── Load credentials from ~/.aspen-release-env ──
const envFile = path.join(os.homedir(), '.aspen-release-env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  console.log('▶ Loaded credentials from ~/.aspen-release-env');
} else {
  // Create the file with placeholders so the user only has to fill it once
  const template = `# Aspen release credentials — fill these in once, never paste exports again
APPLE_ID=mayank.mehta@gmail.com
APPLE_APP_SPECIFIC_PASSWORD=
APPLE_TEAM_ID=S6UBG93XBS
GH_TOKEN=
`;
  fs.writeFileSync(envFile, template, { mode: 0o600 });
  console.log(`▶ Created ${envFile} — fill in your credentials, then re-run.`);
  process.exit(1);
}

// Version comes from CLI arg: npm run release:mac -- 0.4.35
// Falls back to what's in package.json if no arg given.
const cliVersion = process.argv[2];

try {
  execSync('git checkout -- package-lock.json package.json', { stdio: 'inherit' });
} catch {}

// Pull latest code
try {
  execSync('git pull', { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
} catch {}

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// Apply the version to package.json
const VERSION = cliVersion || require(path.join(ROOT, 'package.json')).version;
execSync(`npm version ${VERSION} --no-git-tag-version --allow-same-version`, { cwd: ROOT, stdio: 'inherit' });
// Clear require cache so anything downstream reads the right version
delete require.cache[require.resolve(path.join(ROOT, 'package.json'))];

const TAG = `v${VERSION}`;
const OWNER = 'spideysense';
const REPO = 'OpenLLM';
const GH_TOKEN = process.env.GH_TOKEN;

const ASSETS = ['Aspen-mac.dmg', 'Aspen-mac.zip', 'Aspen-mac.dmg.blockmap', 'Aspen-mac.zip.blockmap', 'latest-mac.yml'];

function ghRequest(method, urlPath, { host = 'api.github.com', body = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body && !Buffer.isBuffer(body) ? JSON.stringify(body) : body;
    const req = https.request({
      host, path: urlPath, method,
      headers: {
        'Authorization': `Bearer ${GH_TOKEN}`,
        'User-Agent': 'aspen-release',
        'Accept': 'application/vnd.github+json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(text ? JSON.parse(text) : {});
        } else {
          reject(new Error(`GitHub ${method} ${urlPath} -> ${res.statusCode}: ${text}`));
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function uploadAsset(releaseId, filePath, name, contentType) {
  return new Promise((resolve, reject) => {
    const stat = fs.statSync(filePath);
    const req = https.request({
      host: 'uploads.github.com',
      path: `/repos/${OWNER}/${REPO}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GH_TOKEN}`,
        'User-Agent': 'aspen-release',
        'Content-Type': contentType,
        'Content-Length': stat.size,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve();
        else reject(new Error(`upload ${name} -> ${res.statusCode}: ${Buffer.concat(chunks)}`));
      });
    });
    req.on('error', reject);
    fs.createReadStream(filePath).pipe(req);
  });
}

function contentTypeFor(name) {
  if (name.endsWith('.dmg')) return 'application/x-apple-diskimage';
  if (name.endsWith('.zip')) return 'application/zip';
  return 'application/octet-stream';
}

(async () => {
  if (!GH_TOKEN) { console.error('Missing GH_TOKEN'); process.exit(1); }

  // Commit + push the version bump so the Windows workflow uses the right version.
  console.log(`▶ Committing version bump to ${VERSION}...`);
  try {
    execSync(`git add package.json`, { cwd: ROOT, stdio: 'inherit' });
    execSync(`git commit -m "chore: bump version to ${VERSION}"`, { cwd: ROOT, stdio: 'inherit' });
    execSync(`git push origin main`, { cwd: ROOT, stdio: 'inherit' });
    console.log(`   ✅ Version ${VERSION} committed and pushed`);
  } catch (e) {
    console.warn('   ⚠️ Could not commit version bump:', e.message);
  }

  // 1. Build the renderer, then SMOKE TEST it before packaging anything. The
  //    smoke test boots the real Electron app against the built renderer and
  //    fails if the main process crashes, the renderer fails to load, the console
  //    has errors, or the page renders blank. This is the gate that would have
  //    caught the v0.4.10 (MCP require crash) and v0.4.11 (blank screen) bugs
  //    BEFORE they shipped. A broken build cannot get past this point.
  // 0. PREFLIGHT — the installed toolchain MUST match package.json. A failed
  //    `npm install` leaves node_modules stale and we'd silently package on the
  //    WRONG Electron (exactly what happened building 0.4.45: a stray '#' the
  //    shell didn't treat as a comment got passed to npm → EINVALIDTAGNAME →
  //    install aborted → build ran on Electron 28 / electron-builder 24, which
  //    then rejected the notarize:true config). Catch it here, loudly.
  console.log('▶ Preflight: verifying installed toolchain matches package.json...');
  {
    const pkg = require(path.join(ROOT, 'package.json'));
    const wantMajor = (name) => String((pkg.devDependencies && pkg.devDependencies[name]) || (pkg.dependencies && pkg.dependencies[name]) || '').replace(/[^\d.]/g, '').split('.')[0];
    const haveMajor = (name) => {
      try { return String(require(path.join(ROOT, 'node_modules', name, 'package.json')).version).split('.')[0]; }
      catch { return null; }
    };
    const mismatches = [];
    for (const dep of ['electron', 'electron-builder']) {
      const w = wantMajor(dep), h = haveMajor(dep);
      if (!h) { mismatches.push(`${dep}: NOT INSTALLED (need ${w}.x)`); continue; }
      if (w && h !== w) mismatches.push(`${dep}: installed ${h}.x, package.json wants ${w}.x`);
    }
    if (mismatches.length) {
      console.error('\n❌ Toolchain mismatch — node_modules is stale, refusing to build:');
      mismatches.forEach((m) => console.error('   • ' + m));
      console.error('\n   Your last `npm install` likely failed. Run it cleanly — do NOT append a');
      console.error('   "# comment" (interactive zsh can pass the # to npm as a package name) — then retry:\n');
      console.error('     npm install');
      console.error(`     npm run release:mac -- ${VERSION}\n`);
      process.exit(1);
    }
    console.log(`   ✓ electron ${haveMajor('electron')}.x · electron-builder ${haveMajor('electron-builder')}.x match package.json`);
  }

  console.log('▶ Building renderer...');
  execSync('npm run build:renderer', { cwd: ROOT, stdio: 'inherit' });

  // Rebuild native modules against the exact Electron version before packaging.
  // This ensures shipped native modules (sharp, and any future ones) are compiled
  // for the correct ABI and will work inside the distributed app. robotjs was
  // removed in the Electron 42 upgrade — Computer Use is osascript/PowerShell now.
  console.log('▶ Rebuilding native modules for Electron...');
  try {
    execSync('npx @electron/rebuild -f', { cwd: ROOT, stdio: 'inherit' });
    console.log('   ✅ Native modules rebuilt');
  } catch (e) {
    console.warn('   ⚠️ electron-rebuild failed — continuing:', e.message);
    console.warn('   (Computer Use uses osascript/PowerShell and does not depend on native modules.)');
  }

  console.log('▶ Smoke testing the built app (must boot + render)...');
  execSync('node scripts/smoke-test.js', { cwd: ROOT, stdio: 'inherit' });

  // Behavioral smoke — DETERMINISTIC layer only (tool routing + capability
  // tiers). This is instant and gates the release. The live model layer is NOT
  // run here: it takes minutes on a large model and would make releases look
  // hung. Run `npm run smoke` (with Ollama up) to exercise the live agent.
  console.log('▶ Behavioral smoke test (routing + capability tiers)...');
  try {
    execSync('node scripts/smoke-behavioral.js --deterministic-only', { cwd: ROOT, stdio: 'inherit' });
  } catch (e) {
    console.error('\n❌ Behavioral smoke test failed — refusing to build.');
    console.error('   (A routing/capability regression. Run `npm run smoke` for details.)');
    process.exit(1);
  }

  console.log('▶ Packaging DMG (no publish) — staple hook will notarize+staple...');
  execSync('electron-builder --mac --publish never', { cwd: ROOT, stdio: 'inherit' });

  // 1b. Verify the DMG is actually stapled before we upload anything.
  console.log('▶ Verifying DMG staple...');
  execSync(`xcrun stapler validate "${path.join(DIST, 'Aspen-mac.dmg')}"`, { stdio: 'inherit' });

  // 2. Delete any existing release+tag for this version (clean re-publish).
  console.log(`▶ Clearing any existing ${TAG} release...`);
  try {
    const rel = await ghRequest('GET', `/repos/${OWNER}/${REPO}/releases/tags/${TAG}`);
    if (rel && rel.id) await ghRequest('DELETE', `/repos/${OWNER}/${REPO}/releases/${rel.id}`);
  } catch (e) { /* no existing release, fine */ }
  try { await ghRequest('DELETE', `/repos/${OWNER}/${REPO}/git/refs/tags/${TAG}`); } catch (e) { /* no tag, fine */ }

  // 3. Create a fresh, published release.
  console.log(`▶ Creating release ${TAG}...`);
  const release = await ghRequest('POST', `/repos/${OWNER}/${REPO}/releases`, {
    body: { tag_name: TAG, name: TAG, draft: false, prerelease: false, make_latest: 'true', target_commitish: 'main' },
  });

  // 4. Upload the already-stapled artifacts.
  for (const name of ASSETS) {
    const fp = path.join(DIST, name);
    if (!fs.existsSync(fp)) { console.log(`  (skip ${name} — not found)`); continue; }
    console.log(`▶ Uploading ${name}...`);
    await uploadAsset(release.id, fp, name, contentTypeFor(name));
  }

  // 5. VERIFY the release is actually the one users will get. This is the check
  //    that was missing when v0.4.5 shipped as a draft and the site kept serving
  //    v0.4.4. Confirm /releases/latest now reports OUR tag — fail loudly if not.
  console.log(`▶ Verifying ${TAG} is the served 'latest' release...`);
  const latest = await ghRequest('GET', `/repos/${OWNER}/${REPO}/releases/latest`);
  if (!latest || latest.tag_name !== TAG) {
    console.error(`\n❌ RELEASE NOT SERVED: GitHub 'latest' is ${latest ? latest.tag_name : 'unknown'}, not ${TAG}.`);
    console.error(`   The website would still serve the OLD version. Marking ${TAG} as latest...`);
    // Auto-correct: publish + force latest on the release we just made.
    await ghRequest('PATCH', `/repos/${OWNER}/${REPO}/releases/${release.id}`, {
      body: { draft: false, make_latest: 'true' },
    });
    const recheck = await ghRequest('GET', `/repos/${OWNER}/${REPO}/releases/latest`);
    if (!recheck || recheck.tag_name !== TAG) {
      console.error(`❌ STILL not latest after correction. Fix manually before announcing.`);
      process.exit(1);
    }
    console.log(`   ✅ Corrected — ${TAG} is now the served latest.`);
  } else {
    console.log(`   ✅ Confirmed — users downloading now get ${TAG}.`);
  }

  // 6. Kick off the Windows EXE build (runs on a GitHub Windows runner) so every
  //    Mac release also gets a matching Aspen-win.exe attached to this same tag.
  //    The release-windows.yml push-tag trigger does NOT fire for tags created via
  //    the releases API (GitHub suppresses that), so we dispatch it explicitly.
  try {
    console.log(`▶ Triggering Windows EXE build for ${TAG}...`);
    await ghRequest('POST', `/repos/${OWNER}/${REPO}/actions/workflows/release-windows.yml/dispatches`, {
      body: { ref: 'main', inputs: { tag: TAG } },
    });
    console.log(`   ✅ Windows build started — Aspen-win.exe will attach to ${TAG} in a few minutes.`);
    console.log(`   Track it: https://github.com/${OWNER}/${REPO}/actions/workflows/release-windows.yml`);
  } catch (e) {
    console.error(`   ⚠️ Could not auto-trigger Windows build: ${e.message}`);
    console.error(`   Run it manually: Actions → Release Windows EXE → Run workflow → tag ${TAG}`);
  }

  // 7. Kick off the Linux arm64 build (AppImage + deb) the same way, so every
  //    Mac release also gets matching Linux packages attached to this same tag.
  try {
    console.log(`▶ Triggering Linux (arm64) build for ${TAG}...`);
    await ghRequest('POST', `/repos/${OWNER}/${REPO}/actions/workflows/release-linux.yml/dispatches`, {
      body: { ref: 'main', inputs: { tag: TAG } },
    });
    console.log(`   ✅ Linux build started — AppImage + deb will attach to ${TAG} in a few minutes.`);
    console.log(`   Track it: https://github.com/${OWNER}/${REPO}/actions/workflows/release-linux.yml`);
  } catch (e) {
    console.error(`   ⚠️ Could not auto-trigger Linux build: ${e.message}`);
    console.error(`   Run it manually: Actions → Release Linux → Run workflow → tag ${TAG}`);
  }

  console.log(`\n✅ Released ${TAG} — DMG stapled BEFORE upload AND verified as served 'latest'.`);
  console.log(`   ${release.html_url}`);
})().catch((e) => { console.error('Release failed:', e.message); process.exit(1); });
