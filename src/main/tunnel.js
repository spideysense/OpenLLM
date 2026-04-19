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

const LOCAL_API = process.env.LLMBEAR_LOCAL_API || 'http://localhost:4000';
const BIN_DIR = path.join(os.homedir(), '.monet', 'bin');

const RECONNECT_BASE = 5000;
const MAX_RECONNECT = 60000;

let proc = null;
let publicUrl = null;
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
  launch();
}

function stop() {
  isShuttingDown = true;
  if (proc) { proc.kill(); proc = null; }
  publicUrl = null;
  notifyStatus('disconnected');
}

function getPublicUrl() { return publicUrl; }
function isConnected() { return !!publicUrl && !!proc; }

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
    // Universal binary works on both Intel and Apple Silicon
    return 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-universal';
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
    // All cloudflared releases are raw binaries — download directly, no extraction
    await downloadFile(url, binPath);

    if (fs.statSync(binPath).size < 1_000_000) {
      fs.unlinkSync(binPath);
      throw new Error('Downloaded file too small — likely a redirect error');
    }

    if (process.platform !== 'win32') {
      fs.chmodSync(binPath, 0o755);
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
      mod.get(url, { headers: { 'User-Agent': 'LLMBear/1.0' } }, (res) => {
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
    if (publicUrl) return; // already found
    const text = data.toString();
    const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
    if (match) {
      publicUrl = match[0];
      reconnectDelay = RECONNECT_BASE;
      console.log('[Tunnel] Public URL:', publicUrl);
      notifyStatus('connected', { url: publicUrl });
      // Push the new URL to Vercel so the website character chat stays current
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
