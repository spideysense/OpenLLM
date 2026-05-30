/**
 * Aspen Tunnel — Cloudflare Named Tunnel
 *
 * Gives every user a permanent, free public HTTPS URL for their local AI.
 * Uses Cloudflare named tunnels provisioned via the Aspen provisioning API.
 *
 * On first launch:
 * 1. Downloads `cloudflared` binary if not present (~30MB, one time)
 * 2. Calls provisioning API → gets a tunnel token + stable URL
 * 3. Stores token locally (never changes)
 *
 * On every launch:
 * 1. Runs: cloudflared tunnel run --token <TOKEN>
 * 2. Stable URL like https://a1b2c3d4.runonaspen.com is live while Aspen runs
 *
 * URL never changes. Cost: $0. No relay server. No Cloudflare account for the user.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const os = require('os');

const LOCAL_API = process.env.MONET_LOCAL_API || 'http://localhost:4000';
const BIN_DIR = path.join(os.homedir(), '.aspen', 'bin');
const PROVISION_URL = process.env.ASPEN_PROVISION_URL || 'https://runonaspen.com/api/tunnel-provision';
const PROVISION_SECRET = process.env.ASPEN_PROVISION_SECRET || 'aspen_prov_8f2a4c6e9d1b3f5a7c0e2d4b6a8f1c3e';
const store = require('./store');

const RECONNECT_BASE = 5000;
const MAX_RECONNECT = 60000;

let proc = null;
let stableUrl = null;
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
  stableUrl = store.get('tunnelUrl') || null;
  launch();
}

function stop() {
  isShuttingDown = true;
  if (proc) { proc.kill(); proc = null; }
  notifyStatus('disconnected');
}

function getPublicUrl() { return stableUrl; }
function isConnected() { return !!(proc && stableUrl); }

// ═══════════════════════════════════════════════════
// Binary — download cloudflared if needed
// ═══════════════════════════════════════════════════

function getBinaryPath() {
  const ext = process.platform === 'win32' ? '.exe' : '';
  return path.join(BIN_DIR, `cloudflared${ext}`);
}

function getDownloadUrl() {
  const p = process.platform;
  const a = process.arch;
  if (p === 'darwin') {
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
      const archivePath = binPath + '.tgz';
      await downloadFile(url, archivePath);

      if (fs.statSync(archivePath).size < 100_000) {
        fs.unlinkSync(archivePath);
        throw new Error('Downloaded file too small — likely a 404 or redirect error');
      }

      const { execSync } = require('child_process');
      execSync(`tar -xzf "${archivePath}" -C "${BIN_DIR}"`, { stdio: 'pipe' });
      fs.unlinkSync(archivePath);

      if (!fs.existsSync(binPath)) {
        const files = fs.readdirSync(BIN_DIR);
        const match = files.find(f => f.startsWith('cloudflared') && !f.endsWith('.tgz'));
        if (match && match !== path.basename(binPath)) {
          fs.renameSync(path.join(BIN_DIR, match), binPath);
        }
      }
    } else {
      await downloadFile(url, binPath);
    }

    if (!fs.existsSync(binPath) || fs.statSync(binPath).size < 1_000_000) {
      if (fs.existsSync(binPath)) fs.unlinkSync(binPath);
      throw new Error('Binary not found or too small after extraction');
    }

    if (process.platform !== 'win32') {
      fs.chmodSync(binPath, 0o755);
    }

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
      mod.get(url, { headers: { 'User-Agent': 'Aspen/1.0' } }, (res) => {
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
// Provisioning — get a permanent tunnel token (one-time)
// ═══════════════════════════════════════════════════

async function ensureProvisioned() {
  let token = store.get('tunnelToken');
  let url = store.get('tunnelUrl');

  if (token && url) {
    console.log('[Tunnel] Already provisioned:', url);
    stableUrl = url;
    return { token, url };
  }

  console.log('[Tunnel] Provisioning permanent tunnel...');
  notifyStatus('provisioning');

  try {
    const data = await postJson(PROVISION_URL, { secret: PROVISION_SECRET });

    if (!data.token || !data.url) {
      throw new Error('Provisioning response missing token or url');
    }

    store.set('tunnelToken', data.token);
    store.set('tunnelUrl', data.url);
    store.set('tunnelId', data.tunnelId);
    store.set('tunnelHostname', data.hostname);
    stableUrl = data.url;

    console.log(`[Tunnel] Provisioned! Permanent URL: ${data.url}`);
    return { token: data.token, url: data.url };
  } catch (err) {
    console.error('[Tunnel] Provisioning failed:', err.message);
    notifyStatus('error', {
      message: 'Could not provision tunnel: ' + err.message,
      recoverable: true,
    });
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
        'X-Aspen-Secret': body.secret || '',
        'User-Agent': 'Aspen/1.0',
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
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(payload);
    req.end();
  });
}

// ═══════════════════════════════════════════════════
// Launch — named tunnel (permanent URL)
// ═══════════════════════════════════════════════════

async function launch() {
  if (isShuttingDown) return;

  notifyStatus('connecting');

  // Step 1: Ensure cloudflared binary is downloaded
  const binPath = await ensureBinary();
  if (!binPath) {
    scheduleReconnect();
    return;
  }

  // Step 2: Ensure we have a tunnel token (provision if first time)
  const tunnel = await ensureProvisioned();
  if (!tunnel) {
    scheduleReconnect();
    return;
  }

  // Step 3: Run the named tunnel
  const args = ['tunnel', '--no-autoupdate', 'run', '--token', tunnel.token];

  // Clear macOS quarantine
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

  let connected = false;

  function parseOutput(data) {
    const text = data.toString();
    console.log('[Tunnel] cloudflared:', text.trim().slice(0, 200));

    // Named tunnels log "Registered tunnel connection" when connected
    if (!connected && (
      text.includes('Registered tunnel connection') ||
      text.includes('Connection registered') ||
      text.includes('connIndex=')
    )) {
      connected = true;
      reconnectDelay = RECONNECT_BASE;
      console.log(`[Tunnel] Connected! URL: ${stableUrl}`);
      notifyStatus('connected', { url: stableUrl });
    }

    // Detect auth errors (bad/expired token)
    if (text.includes('ERR') && text.includes('auth')) {
      console.error('[Tunnel] Auth error — token may be invalid. Clearing stored credentials.');
      store.delete('tunnelToken');
      store.delete('tunnelUrl');
      store.delete('tunnelId');
      store.delete('tunnelHostname');
      stableUrl = null;
    }
  }

  proc.stderr.on('data', parseOutput);
  proc.stdout.on('data', parseOutput);

  proc.on('close', (code) => {
    console.log(`[Tunnel] cloudflared exited (code ${code})`);
    proc = null;
    if (!isShuttingDown) {
      notifyStatus('disconnected');
      scheduleReconnect();
    }
  });

  proc.on('error', (err) => {
    console.error('[Tunnel] Process error:', err.message);
    proc = null;
    notifyStatus('error', { message: err.message });
    scheduleReconnect();
  });

  // Timeout: if not connected in 30s, something is wrong
  setTimeout(() => {
    if (!connected && proc && !isShuttingDown) {
      console.warn('[Tunnel] Connection timeout — restarting');
      proc.kill();
    }
  }, 30000);
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

module.exports = { start, stop, getPublicUrl, isConnected };
