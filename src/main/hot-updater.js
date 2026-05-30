/**
 * Aspen Hot Updater
 *
 * Updates the renderer (UI) without requiring a new DMG.
 * On launch (and every 4h), fetches runonaspen.com/updates/latest.json.
 * If the renderer version there is newer than what's running, downloads
 * the zip, extracts to userData/renderer/, and reloads the window.
 *
 * The native DMG updater (electron-updater) handles Electron binary bumps —
 * those are rare. This covers every UI/logic change, which is all the time.
 *
 * Safety: if anything goes wrong, falls back to bundled build/ silently.
 */

const { app, net } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { pipeline } = require('stream/promises');
const { createWriteStream } = require('fs');
const zlib = require('zlib');

const MANIFEST_URL = 'https://runonaspen.com/updates/latest.json';
const CHECK_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours

let mainWindow = null;
let checkTimer = null;

// ── Paths ──
function hotDir()    { return path.join(app.getPath('userData'), 'renderer'); }
function hotIndex()  { return path.join(hotDir(), 'index.html'); }
function versionFile() { return path.join(hotDir(), '.version'); }
function zipTmp()    { return path.join(app.getPath('temp'), 'aspen-renderer.zip'); }

// ═══════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════

/**
 * Returns the path to load — hot dir if valid, else bundled.
 * Call this BEFORE createWindow.
 */
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
  // Startup check already happened before window creation — just set the interval
  checkTimer = setInterval(() => checkForUpdate(), CHECK_INTERVAL);
}

function stop() {
  if (checkTimer) { clearInterval(checkTimer); checkTimer = null; }
}

function getCurrentVersion() {
  return currentHotVersion() || 'bundled';
}

// ═══════════════════════════════════════════════════
// Core logic
// ═══════════════════════════════════════════════════

async function checkForUpdate({ timeout = 8000 } = {}) {
  // Wrap with a timeout so startup is never blocked indefinitely
  return Promise.race([
    _doCheckForUpdate(),
    new Promise(resolve => setTimeout(resolve, timeout)),
  ]);
}

async function _doCheckForUpdate() {
  try {
    const manifest = await fetchJson(MANIFEST_URL);
    if (!manifest?.rendererVersion || !manifest?.rendererUrl) {
      console.log('[HotUpdater] Manifest missing fields, skipping');
      return;
    }

    const remote = manifest.rendererVersion;
    const current = currentHotVersion() || app.getVersion();

    console.log(`[HotUpdater] Remote: ${remote} | Current: ${current}`);

    if (!isNewer(remote, current)) {
      console.log('[HotUpdater] Already up to date');
      return;
    }

    console.log('[HotUpdater] Update available — downloading...');
    notify('downloading', { version: remote });

    await downloadZip(manifest.rendererUrl, zipTmp());
    await extractZip(zipTmp(), hotDir());
    fs.writeFileSync(versionFile(), remote, 'utf8');
    fs.rmSync(zipTmp(), { force: true });

    console.log('[HotUpdater] Renderer updated to', remote);
    notify('ready', { version: remote });

    // Reload the window with the new renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadFile(hotIndex());
    }
  } catch (err) {
    console.error('[HotUpdater] Check failed:', err.message);
    // Never crash — bundled renderer is always the fallback
  }
}

// ═══════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════

function hasValidHotRenderer() {
  try {
    return fs.existsSync(hotIndex()) && fs.statSync(hotIndex()).size > 0;
  } catch { return false; }
}

function currentHotVersion() {
  try { return fs.readFileSync(versionFile(), 'utf8').trim(); } catch { return null; }
}

function isNewer(remote, current) {
  // Simple semver comparison — splits on dots, compares numerically
  const parse = v => String(v).replace(/^v/, '').split('.').map(Number);
  const r = parse(remote);
  const c = parse(current);
  for (let i = 0; i < Math.max(r.length, c.length); i++) {
    const a = r[i] ?? 0, b = c[i] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 8000 }, (res) => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('Bad JSON from manifest')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Manifest timeout')); });
  });
}

async function downloadZip(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    https.get(url, { timeout: 60000 }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Minimal zip extractor — Node has no built-in zip support.
 * Uses the system unzip command (available on macOS and most Linux).
 * Falls back to a pure-JS approach for Windows.
 */
async function extractZip(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });

  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);

  if (process.platform === 'win32') {
    // PowerShell expand-archive (available on Win 10+)
    await execFileAsync('powershell', [
      '-Command',
      `Expand-Archive -Force -Path "${zipPath}" -DestinationPath "${destDir}"`,
    ]);
  } else {
    // macOS / Linux
    await execFileAsync('unzip', ['-o', '-q', zipPath, '-d', destDir]);
  }
}

function notify(status, data = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('hotUpdater:status', { status, ...data });
  }
}

module.exports = { init, stop, resolveRendererPath, checkForUpdate, getCurrentVersion };
