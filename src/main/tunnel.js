/**
 * Monet Tunnel — Cloudflare Quick Tunnel
 *
 * Gives every user a free public HTTPS URL for their local AI.
 * Uses Cloudflare's free quick tunnel — no account, no backend needed.
 *
 * On app start:
 * 1. Downloads `cloudflared` binary if not present (~30MB, one time)
 * 2. Runs: cloudflared tunnel --url http://localhost:4000
 * 3. Parses the assigned URL from stderr (e.g. https://abc-xyz.trycloudflare.com)
 * 4. Notifies the renderer — user sees + copies their public URL
 *
 * URL changes on each restart (Cloudflare quick tunnel limitation).
 * Cost: $0. No relay server. No Cloudflare account.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const os = require('os');

const LOCAL_API = process.env.MONET_LOCAL_API || 'http://localhost:4000';
const BIN_DIR = path.join(os.homedir(), '.monet', 'bin');
const RELAY_URL = process.env.MONET_RELAY_URL || 'https://api.getmonet.com';
const store = require('./store');

const RECONNECT_BASE = 5000;
const MAX_RECONNECT = 60000;

let proc = null;
let publicUrl = null;    // raw cloudflare URL (changes on restart)
let stableUrl = null;    // stable relay URL (never changes)
let heartbeatInterval = null;
let isShuttingDown = false;
let reconnectDelay = RECONNECT_BASE;
let onStatusChange = null;

// ═══════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════

function start(statusCallback) {
  onStatusChange = statusCallback || (() => {});
  isShuttingDown = false;
  reconnectDelay = RECONNECT_BASE;
  // Load last known stable URL
  stableUrl = store.get('stableUrl') || null;
  launch();
  // Heartbeat every 2 minutes to keep the stable URL mapping alive
  heartbeatInterval = setInterval(() => {
    if (publicUrl) sendHeartbeat(publicUrl).catch(() => {});
  }, 2 * 60 * 1000);
}

function stop() {
  isShuttingDown = true;
  if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
  if (proc) { proc.kill(); proc = null; }
  publicUrl = null;
  notifyStatus('disconnected');
}

function getPublicUrl() { return stableUrl || publicUrl; }
function isConnected() { return !!(publicUrl && proc); }

// ═══════════════════════════════════════════════════
// Binary — correct URLs verified against GitHub releases API
// cloudflared releases use raw binaries (no archives) on all platforms
// ═══════════════════════════════════════════════════

function getBinaryPath() {
  const ext = process.platform === 'win32' ? '.exe' : '';
  return path.join(BIN_DIR, `cloudflared${ext}`);
}

function getDownloadUrl() {
  const p = process.platform;
  const a = process.arch;
  if (p === 'darwin') {
    // No more universal binary — use arch-specific tgz archives
    return a === 'arm64'
      ? 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz'
      : 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz';
  }
  if (p === 'win32') {
    return 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';
  }
  if (p === 'linux') {
    return a === 'arm64'
      ? 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64'
      : 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64';
  }
  return null;
}

async function ensureBinary() {
  const binPath = getBinaryPath();

  // Already downloaded — check it's a real binary (> 1MB)
  if (fs.existsSync(binPath) && fs.statSync(binPath).size > 1_000_000) {
    return binPath;
  }

  const url = getDownloadUrl();
  if (!url) {
    console.error('[Tunnel] Unsupported platform:', process.platform, process.arch);
    return null;
  }

  console.log('[Tunnel] Downloading cloudflared from', url);
  notifyStatus('downloading');

  fs.mkdirSync(BIN_DIR, { recursive: true });

  try {
    const isTgz = url.endsWith('.tgz');

    if (isTgz) {
      // Download archive, extract the binary
      const archivePath = binPath + '.tgz';
      await downloadFile(url, archivePath);

      if (fs.statSync(archivePath).size < 100_000) {
        fs.unlinkSync(archivePath);
        throw new Error('Downloaded file too small — likely a 404 or redirect error');
      }

      // Extract — cloudflared tgz contains the binary at the root
      const { execSync } = require('child_process');
      execSync(`tar -xzf "${archivePath}" -C "${BIN_DIR}"`, { stdio: 'pipe' });
      fs.unlinkSync(archivePath);

      // The extracted binary might be named 'cloudflared' already, or we need to find it
      if (!fs.existsSync(binPath)) {
        // Scan for it
        const files = fs.readdirSync(BIN_DIR);
        const match = files.find(f => f.startsWith('cloudflared') && !f.endsWith('.tgz'));
        if (match && match !== path.basename(binPath)) {
          fs.renameSync(path.join(BIN_DIR, match), binPath);
        }
      }
    } else {
      // Direct binary download (Windows, Linux)
      await downloadFile(url, binPath);
    }

    if (!fs.existsSync(binPath) || fs.statSync(binPath).size < 1_000_000) {
      if (fs.existsSync(binPath)) fs.unlinkSync(binPath);
      throw new Error('Binary not found or too small after extraction');
    }

    if (process.platform !== 'win32') {
      fs.chmodSync(binPath, 0o755);
    }

    // macOS: clear quarantine attribute or Gatekeeper silently blocks execution
    if (process.platform === 'darwin') {
      try {
        require('child_process').execSync(`xattr -cr "${binPath}"`, { stdio: 'pipe' });
        console.log('[Tunnel] Cleared quarantine attribute');
      } catch (e) {
        console.log('[Tunnel] xattr clear skipped:', e.message);
      }
    }

    const sizeMB = (fs.statSync(binPath).size / 1e6).toFixed(0);
    console.log(`[Tunnel] cloudflared ready (${sizeMB}MB) at ${binPath}`);
    return binPath;
  } catch (err) {
    console.error('[Tunnel] Download failed:', err.message);
    notifyStatus('error', { message: 'Could not download cloudflared: ' + err.message });
    return null;
  }
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const follow = (url, redirects = 0) => {
      if (redirects > 10) return reject(new Error('Too many redirects'));
      const mod = url.startsWith('https') ? https : http;
      mod.get(url, { headers: { 'User-Agent': 'Monet/1.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return follow(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
      }).on('error', reject);
    };
    follow(url);
  });
}

// ═══════════════════════════════════════════════════
// ═══════════════════════════════════════════════════
// Stable URL — register with relay, heartbeat to keep mapping alive
// ═══════════════════════════════════════════════════

async function ensureRegistered() {
  let tunnelId = store.get('tunnelId');
  let tunnelSecret = store.get('tunnelSecret');
  if (tunnelId && tunnelSecret) return { tunnelId, tunnelSecret };

  console.log('[Tunnel] Registering for stable URL...');
  try {
    const data = await postJson(`${RELAY_URL}/tunnel/register`, {});
    tunnelId = data.tunnelId;
    tunnelSecret = data.tunnelSecret;
    store.set('tunnelId', tunnelId);
    store.set('tunnelSecret', tunnelSecret);
    stableUrl = data.url;
    store.set('stableUrl', data.url);
    console.log(`[Tunnel] Stable URL: ${data.url}`);
    return { tunnelId, tunnelSecret };
  } catch (err) {
    console.error('[Tunnel] Registration failed:', err.message);
    return null;
  }
}

async function sendHeartbeat(cfUrl) {
  const tunnelId = store.get('tunnelId');
  const tunnelSecret = store.get('tunnelSecret');
  if (!tunnelId || !tunnelSecret) return;

  try {
    const data = await postJson(`${RELAY_URL}/tunnel/heartbeat`, {
      tunnelId, tunnelSecret, cloudflareUrl: cfUrl,
    });
    if (data.url) {
      stableUrl = data.url;
      store.set('stableUrl', data.url);
    }
    return data;
  } catch (err) {
    console.error('[Tunnel] Heartbeat failed:', err.message);
    return null;
  }
}

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const parsed = new URL(url);
    const payload = JSON.stringify(body);
    const req = mod.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'User-Agent': 'Monet/1.0',
      },
    }, (res) => {
      let data = '';
      res.on('data', (d) => data += d);
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(payload);
    req.end();
  });
}

// ═══════════════════════════════════════════════════
// Launch
// ═══════════════════════════════════════════════════

async function launch() {
  if (isShuttingDown) return;

  notifyStatus('connecting');

  const binPath = await ensureBinary();
  if (!binPath) {
    scheduleReconnect();
    return;
  }

  const args = ['tunnel', '--url', LOCAL_API, '--no-autoupdate'];

  // Clear quarantine on existing binary (might have been downloaded before this fix)
  if (process.platform === 'darwin') {
    try {
      require('child_process').execSync(`xattr -cr "${binPath}"`, { stdio: 'pipe' });
    } catch (e) {}
  }

  try {
    proc = spawn(binPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
  } catch (err) {
    console.error('[Tunnel] Spawn error:', err.message);
    notifyStatus('error', { message: err.message });
    scheduleReconnect();
    return;
  }

  // cloudflared logs the assigned URL to stderr
  function parseUrl(data) {
    const text = data.toString();
    console.log('[Tunnel] cloudflared:', text.trim().slice(0, 200));
    if (publicUrl) return; // already found
    const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
    if (match) {
      publicUrl = match[0];
      reconnectDelay = RECONNECT_BASE;
      console.log('[Tunnel] Cloudflare URL:', publicUrl);

      // Register for a stable URL, then heartbeat with the new cloudflare URL
      (async () => {
        await ensureRegistered();
        await sendHeartbeat(publicUrl);
        const displayUrl = stableUrl || publicUrl;
        console.log('[Tunnel] Display URL:', displayUrl);
        notifyStatus('connected', { url: displayUrl });
      })().catch(() => {
        // Fall back to raw cloudflare URL if relay is down
        notifyStatus('connected', { url: publicUrl });
      });

      pushUrlToVercel(publicUrl).catch(() => {});
    }
  }

  proc.stderr.on('data', parseUrl);
  proc.stdout.on('data', parseUrl);

  proc.on('close', (code) => {
    console.log(`[Tunnel] cloudflared exited (code ${code})`);
    proc = null;
    publicUrl = null;
    if (!isShuttingDown) {
      notifyStatus('disconnected');
      scheduleReconnect();
    }
  });

  proc.on('error', (err) => {
    console.error('[Tunnel] Process error:', err.message);
    proc = null;
    publicUrl = null;
    notifyStatus('error', { message: err.message });
    scheduleReconnect();
  });
}

function scheduleReconnect() {
  if (isShuttingDown) return;
  notifyStatus('reconnecting');
  setTimeout(() => launch(), reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT);
}

function notifyStatus(status, data = {}) {
  if (onStatusChange) onStatusChange({ status, ...data });
}

// Push current tunnel URL to Vercel environment variable so the website
// character chat always points at the live instance.
// Requires VERCEL_TOKEN + VERCEL_PROJECT_ID in the app's env (optional).
async function pushUrlToVercel(url) {
  const token     = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (!token || !projectId) return; // not configured — skip silently

  try {
    // Upsert the MONET_BASE_URL env var on the production deployment

    const https = require('https');
    const body = JSON.stringify([{
      key: 'MONET_BASE_URL',
      value: url,
      type: 'plain',
      target: ['production'],
    }]);

    await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.vercel.com',
        path: `/v10/projects/${projectId}/env`,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          if (res.statusCode === 201 || res.statusCode === 200) {
            console.log('[Tunnel] Updated MONET_BASE_URL in Vercel');
          } else if (res.statusCode === 409) {
            // Already exists — update it instead
            updateVercelEnv(token, projectId, url);
          }
          resolve();
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  } catch (err) {
    console.log('[Tunnel] Could not update Vercel env:', err.message);
  }
}

async function updateVercelEnv(token, projectId, url) {
  // First find the env var ID, then patch it
  const https = require('https');
  try {
    const listRes = await new Promise((resolve, reject) => {
      https.get({
        hostname: 'api.vercel.com',
        path: `/v10/projects/${projectId}/env`,
        headers: { 'Authorization': `Bearer ${token}` },
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });

    const envVar = listRes.envs?.find(e => e.key === 'MONET_BASE_URL');
    if (!envVar) return;

    const body = JSON.stringify({ value: url });
    const req = https.request({
      hostname: 'api.vercel.com',
      path: `/v10/projects/${projectId}/env/${envVar.id}`,
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      res.resume();
      if (res.statusCode === 200) {
        console.log('[Tunnel] Patched MONET_BASE_URL in Vercel →', url);
      }
    });
    req.on('error', () => {});
    req.write(body);
    req.end();
  } catch {}
}

module.exports = { start, stop, getPublicUrl, isConnected };
