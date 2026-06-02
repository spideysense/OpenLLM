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
 * Required env: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID, GH_TOKEN
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const pkg = require(path.join(ROOT, 'package.json'));
const VERSION = pkg.version;
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

  // 1. Build (renderer + electron-builder with NO publish). Staple hook runs here.
  console.log('▶ Building (no publish) — staple hook will notarize+staple the DMG...');
  execSync('npm run build:renderer && electron-builder --mac --publish never', { cwd: ROOT, stdio: 'inherit' });

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

  console.log(`\n✅ Released ${TAG} — DMG stapled BEFORE upload AND verified as served 'latest'.`);
  console.log(`   ${release.html_url}`);
})().catch((e) => { console.error('Release failed:', e.message); process.exit(1); });
