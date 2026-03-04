/**
 * LLM Bear Tunnel — Cloudflare Quick Tunnel
 *
 * Gives every user a free public URL for their local AI.
 * Uses Cloudflare's free quick tunnel (no account required).
 *
 * On app start:
 * 1. Downloads `cloudflared` binary if not present
 * 2. Runs: cloudflared tunnel --url http://localhost:4000
 * 3. Parses the assigned URL (e.g. https://abc-xyz.trycloudflare.com)
 * 4. Notifies the renderer so user can see + copy their URL
 *
 * Cost: $0. No relay server. No Fly.io. No Cloudflare account.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
const os = require('os');
const store = require('./store');

const LOCAL_API = process.env.LLMBEAR_LOCAL_API || 'http://localhost:4000';
const RECONNECT_DELAY = 5000;
const MAX_RECONNECT_DELAY = 60000;

let proc = null;
let publicUrl = null;
let isShuttingDown = false;
let reconnectDelay = RECONNECT_DELAY;
let onStatusChange = null;

// ═══════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════

function start(statusCallback) {
  onStatusChange = statusCallback || (() => {});
  isShuttingDown = false;
  reconnectDelay = RECONNECT_DELAY;
  launch();
}

function stop() {
  isShuttingDown = true;
  if (proc) {
    proc.kill();
    proc = null;
  }
  publicUrl = null;
  notifyStatus('disconnected');
}

function getPublicUrl() {
  return publicUrl;
}

function isConnected() {
  return publicUrl !== null && proc !== null;
}

// ═══════════════════════════════════════════════════
// Cloudflared Binary Management
// ═══════════════════════════════════════════════════

function getBinaryDir() {
  return path.join(os.homedir(), '.llmbear', 'bin');
}

function getBinaryPath() {
  const dir = getBinaryDir();
  const ext = process.platform === 'win32' ? '.exe' : '';
  return path.join(dir, `cloudflared${ext}`);
}

function getDownloadUrl() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'darwin') {
    return 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz';
  } else if (platform === 'win32') {
    return 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';
  } else if (platform === 'linux') {
    const linuxArch = arch === 'arm64' ? 'arm64' : 'amd64';
    return 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-' + linuxArch;
  }
  return null;
}

async function ensureBinary() {
  const binPath = getBinaryPath();

  if (fs.existsSync(binPath)) {
    return binPath;
  }

  const url = getDownloadUrl();
  if (!url) {
    console.error('[Tunnel] Unsupported platform:', process.platform, process.arch);
    return null;
  }

  console.log('[Tunnel] Downloading cloudflared...');
  notifyStatus('downloading');

  const dir = getBinaryDir();
  fs.mkdirSync(dir, { recursive: true });

  try {
    if (url.endsWith('.tgz')) {
      const tgzPath = path.join(dir, 'cloudflared.tgz');
      await downloadFile(url, tgzPath);
      const { execSync } = require('child_process');
      execSync(`tar -xzf "${tgzPath}" -C "${dir}"`, { stdio: 'ignore' });
      fs.unlinkSync(tgzPath);
    } else {
      await downloadFile(url, binPath);
    }

    if (process.platform !== 'win32') {
      fs.chmodSync(binPath, 0o755);
    }

    console.log('[Tunnel] cloudflared installed at', binPath);
    return binPath;
  } catch (err) {
    console.error('[Tunnel] Download failed:', err.message);
    notifyStatus('error', { message: 'Failed to download cloudflared: ' + err.message });
    return null;
  }
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const follow = (url, redirects = 0) => {
      if (redirects > 5) return reject(new Error('Too many redirects'));
      https.get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return follow(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', reject);
      }).on('error', reject);
    };
    follow(url);
  });
}

// ═══════════════════════════════════════════════════
// Launch Cloudflare Tunnel
// ═══════════════════════════════════════════════════

async function launch() {
  if (isShuttingDown) return;

  notifyStatus('connecting');

  const binPath = await ensureBinary();
  if (!binPath) {
    notifyStatus('error', { message: 'Could not install cloudflared' });
    scheduleReconnect();
    return;
  }

  const args = ['tunnel', '--url', LOCAL_API, '--no-autoupdate'];

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

  // Parse URL from stderr (cloudflared logs there)
  proc.stderr.on('data', (data) => {
    const text = data.toString();
    const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
    if (match && !publicUrl) {
      publicUrl = match[0];
      reconnectDelay = RECONNECT_DELAY;
      store.set('lastTunnelUrl', publicUrl);
      console.log(`[Tunnel] Public URL: ${publicUrl}`);
      notifyStatus('connected', { url: publicUrl });
    }
  });

  proc.stdout.on('data', (data) => {
    const text = data.toString();
    const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
    if (match && !publicUrl) {
      publicUrl = match[0];
      reconnectDelay = RECONNECT_DELAY;
      store.set('lastTunnelUrl', publicUrl);
      console.log(`[Tunnel] Public URL: ${publicUrl}`);
      notifyStatus('connected', { url: publicUrl });
    }
  });

  proc.on('close', (code) => {
    console.log(`[Tunnel] cloudflared exited with code ${code}`);
    proc = null;
    publicUrl = null;
    notifyStatus('disconnected');
    scheduleReconnect();
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
  reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT_DELAY);
}

// ═══════════════════════════════════════════════════
// Status notifications
// ═══════════════════════════════════════════════════

function notifyStatus(status, data = {}) {
  if (onStatusChange) {
    onStatusChange({ status, ...data });
  }
}

module.exports = {
  start,
  stop,
  getPublicUrl,
  isConnected,
};
