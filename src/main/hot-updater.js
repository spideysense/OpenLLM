/**
 * Aspen Hot Updater — updates the renderer without a new DMG.
 * On launch (and every 4h), fetches runonaspen.com/updates/latest.json.
 * If newer, downloads renderer.zip, extracts to userData/renderer/, reloads window.
 * Bundled build/ is always the fallback if anything goes wrong.
 */
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

const MANIFEST_URL = 'https://runonaspen.com/updates/latest.json';
const CHECK_INTERVAL = 4 * 60 * 60 * 1000;

let mainWindow = null;
let checkTimer = null;

function hotDir()     { return path.join(app.getPath('userData'), 'renderer'); }
function hotIndex()   { return path.join(hotDir(), 'index.html'); }
function versionFile(){ return path.join(hotDir(), '.version'); }
function zipTmp()     { return path.join(app.getPath('temp'), 'aspen-renderer.zip'); }

function resolveRendererPath() {
  if (hasValidHotRenderer()) {
    console.log('[HotUpdater] Loading hot renderer:', currentHotVersion());
    return hotIndex();
  }
  console.log('[HotUpdater] Loading bundled renderer');
  return path.join(__dirname, '..', '..', 'build', 'index.html');
}

function init(win) {
  mainWindow = win;
  checkTimer = setInterval(() => checkForUpdate(), CHECK_INTERVAL);
}

function stop() { if (checkTimer) { clearInterval(checkTimer); checkTimer = null; } }
function getCurrentVersion() { return currentHotVersion() || 'bundled'; }

async function checkForUpdate({ timeout = 30000 } = {}) {
  return Promise.race([_doCheckForUpdate(), new Promise(resolve => setTimeout(resolve, timeout))]);
}

async function _doCheckForUpdate() {
  try {
    const manifest = await fetchJson(MANIFEST_URL);
    if (!manifest?.rendererVersion || !manifest?.rendererUrl) return;
    const remote = manifest.rendererVersion;
    const current = currentHotVersion() || app.getVersion();
    console.log(`[HotUpdater] Remote: ${remote} | Current: ${current}`);
    if (!isNewer(remote, current)) { console.log('[HotUpdater] Up to date'); return; }
    console.log('[HotUpdater] Update available, downloading…');
    notify('downloading', { version: remote });
    await downloadZip(manifest.rendererUrl, zipTmp());
    await extractZip(zipTmp(), hotDir());
    fs.writeFileSync(versionFile(), remote, 'utf8');
    fs.rmSync(zipTmp(), { force: true });
    console.log('[HotUpdater] Updated to', remote);
    notify('ready', { version: remote });
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadFile(hotIndex());
  } catch (err) {
    console.error('[HotUpdater] Check failed:', err.message);
  }
}

function hasValidHotRenderer() {
  try { return fs.existsSync(hotIndex()) && fs.statSync(hotIndex()).size > 0; } catch { return false; }
}
function currentHotVersion() {
  try { return fs.readFileSync(versionFile(), 'utf8').trim(); } catch { return null; }
}
function isNewer(remote, current) {
  const parse = v => String(v).replace(/^v/, '').split('.').map(Number);
  const r = parse(remote), c = parse(current);
  for (let i = 0; i < Math.max(r.length, c.length); i++) {
    const a = r[i] ?? 0, b = c[i] ?? 0;
    if (a > b) return true; if (a < b) return false;
  }
  return false;
}
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 8000 }, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('Bad JSON')); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}
async function downloadZip(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, { timeout: 60000 }, res => {
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', reject);
    }).on('error', reject);
  });
}
async function extractZip(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const yauzl = require('yauzl');
  console.log('[HotUpdater] Extracting…');
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      zipfile.readEntry();
      zipfile.on('entry', entry => {
        const outPath = path.join(destDir, entry.fileName);
        if (/\/$/.test(entry.fileName)) { fs.mkdirSync(outPath, { recursive: true }); zipfile.readEntry(); }
        else {
          fs.mkdirSync(path.dirname(outPath), { recursive: true });
          zipfile.openReadStream(entry, (err, stream) => {
            if (err) return reject(err);
            const w = fs.createWriteStream(outPath);
            stream.pipe(w);
            w.on('finish', () => zipfile.readEntry());
            w.on('error', reject);
          });
        }
      });
      zipfile.on('end', () => { console.log('[HotUpdater] Extraction complete'); resolve(); });
      zipfile.on('error', reject);
    });
  });
}
function notify(status, data = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('hotUpdater:status', { source: 'hot', status, ...data });
}

module.exports = { init, stop, resolveRendererPath, checkForUpdate, getCurrentVersion };
