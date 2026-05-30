/**
 * Tunnel Tests — Cloudflare Named Tunnel
 *
 * STORY: User opens Aspen → app downloads cloudflared → provisions permanent tunnel
 *        → gets stable URL forever → AI accessible from anywhere
 * STORY: Auto-reconnect on disconnect, auto-download binary
 * STORY: IPC bridge exposes tunnel status to the renderer UI
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const clientSrc = fs.readFileSync(path.resolve('src/main/tunnel.js'), 'utf8');
const mainSrc = fs.readFileSync(path.resolve('src/main/index.js'), 'utf8');
const preloadSrc = fs.readFileSync(path.resolve('src/preload/index.js'), 'utf8');

// ═══════════════════════════════════════════════════
// Cloudflared Binary Management
// ═══════════════════════════════════════════════════

describe('Tunnel: Cloudflared binary', () => {
  it('should store binary in ~/.aspen/bin/', () => {
    expect(clientSrc).toContain('.aspen');
    expect(clientSrc).toContain('BIN_DIR');
  });

  it('should handle .exe extension on Windows', () => {
    expect(clientSrc).toContain("win32");
    expect(clientSrc).toContain(".exe");
  });

  it('should download correct binary per platform', () => {
    expect(clientSrc).toContain('getDownloadUrl');
    expect(clientSrc).toContain('darwin');
    expect(clientSrc).toContain('win32');
    expect(clientSrc).toContain('linux');
    expect(clientSrc).toContain('arm64');
    expect(clientSrc).toContain('amd64');
  });

  it('should download from official cloudflared GitHub releases', () => {
    expect(clientSrc).toContain('github.com/cloudflare/cloudflared/releases');
  });

  it('should skip download if binary already exists', () => {
    expect(clientSrc).toContain('existsSync');
    expect(clientSrc).toContain('return binPath');
  });

  it('should download arch-specific tgz for macOS', () => {
    expect(clientSrc).toContain('cloudflared-darwin-arm64.tgz');
    expect(clientSrc).toContain('cloudflared-darwin-amd64.tgz');
  });

  it('should extract tgz archives', () => {
    expect(clientSrc).toContain('tar -xzf');
  });

  it('should make binary executable on Unix', () => {
    expect(clientSrc).toContain('chmodSync');
    expect(clientSrc).toContain('0o755');
  });

  it('should follow redirects when downloading', () => {
    expect(clientSrc).toContain('downloadFile');
    expect(clientSrc).toContain('redirects');
    expect(clientSrc).toContain('location');
  });

  it('should report downloading status to UI', () => {
    expect(clientSrc).toContain("'downloading'");
  });
});

// ═══════════════════════════════════════════════════
// Named Tunnel Provisioning
// ═══════════════════════════════════════════════════

describe('Tunnel: Named tunnel provisioning', () => {
  it('should provision via Aspen API on first launch', () => {
    expect(clientSrc).toContain('ensureProvisioned');
    expect(clientSrc).toContain('PROVISION_URL');
  });

  it('should store tunnel token in electron-store', () => {
    expect(clientSrc).toContain("store.set('tunnelToken'");
    expect(clientSrc).toContain("store.set('tunnelUrl'");
  });

  it('should skip provisioning if already provisioned', () => {
    expect(clientSrc).toContain("store.get('tunnelToken')");
    expect(clientSrc).toContain("store.get('tunnelUrl')");
    expect(clientSrc).toContain('Already provisioned');
  });

  it('should send provision secret in request', () => {
    expect(clientSrc).toContain('X-Aspen-Secret');
    expect(clientSrc).toContain('PROVISION_SECRET');
  });

  it('should report provisioning status to UI', () => {
    expect(clientSrc).toContain("'provisioning'");
  });

  it('should handle auth errors by clearing stored credentials', () => {
    expect(clientSrc).toContain("store.delete('tunnelToken')");
    expect(clientSrc).toContain("store.delete('tunnelUrl')");
  });
});

describe('Tunnel: Provisioning API', () => {
  const provisionSrc = fs.readFileSync(path.resolve('site/api/tunnel-provision.js'), 'utf8');

  it('should create tunnel via Cloudflare API', () => {
    expect(provisionSrc).toContain('cfd_tunnel');
    expect(provisionSrc).toContain('config_src');
  });

  it('should configure ingress for localhost:4000', () => {
    expect(provisionSrc).toContain('localhost:4000');
    expect(provisionSrc).toContain('ingress');
    expect(provisionSrc).toContain('http_status:404');
  });

  it('should create DNS CNAME record', () => {
    expect(provisionSrc).toContain('CNAME');
    expect(provisionSrc).toContain('cfargotunnel.com');
    expect(provisionSrc).toContain('dns_records');
  });

  it('should return tunnel token and stable URL', () => {
    expect(provisionSrc).toContain('tunnelToken');
    expect(provisionSrc).toContain('url');
    expect(provisionSrc).toContain('hostname');
  });

  it('should verify provision secret', () => {
    expect(provisionSrc).toContain('PROVISION_SECRET');
    expect(provisionSrc).toContain('Invalid provision secret');
  });

  it('should clean up tunnel on failure', () => {
    expect(provisionSrc).toContain("method: 'DELETE'");
  });

  it('should generate unique subdomains', () => {
    expect(provisionSrc).toContain('generateSubdomain');
  });
});

// ═══════════════════════════════════════════════════
// Tunnel Process — Named Tunnel
// ═══════════════════════════════════════════════════

describe('Tunnel: Cloudflare named tunnel process', () => {
  it('should spawn cloudflared with tunnel run --token', () => {
    expect(clientSrc).toContain('spawn');
    expect(clientSrc).toContain("'tunnel'");
    expect(clientSrc).toContain("'run'");
    expect(clientSrc).toContain("'--token'");
    expect(clientSrc).toContain("'--no-autoupdate'");
  });

  it('should default to localhost:4000', () => {
    expect(clientSrc).toContain('http://localhost:4000');
  });

  it('should detect connection via "Registered tunnel connection"', () => {
    expect(clientSrc).toContain('Registered tunnel connection');
  });

  it('should parse output from both stdout and stderr', () => {
    expect(clientSrc).toContain("proc.stderr.on('data'");
    expect(clientSrc).toContain("proc.stdout.on('data'");
  });

  it('should auto-reconnect with exponential backoff', () => {
    expect(clientSrc).toContain('scheduleReconnect');
    expect(clientSrc).toContain('RECONNECT_BASE');
    expect(clientSrc).toContain('MAX_RECONNECT');
    expect(clientSrc).toContain('reconnectDelay * 1.5');
  });

  it('should not reconnect when shutting down', () => {
    expect(clientSrc).toContain('isShuttingDown');
    expect(clientSrc).toContain('if (isShuttingDown) return');
  });

  it('should kill process on stop', () => {
    expect(clientSrc).toContain('proc.kill()');
  });

  it('should handle spawn errors gracefully', () => {
    expect(clientSrc).toContain("proc.on('error'");
    expect(clientSrc).toContain("proc.on('close'");
  });

  it('should expose start/stop/getPublicUrl/isConnected', () => {
    expect(clientSrc).toContain('module.exports');
    expect(clientSrc).toContain('start,');
    expect(clientSrc).toContain('stop,');
    expect(clientSrc).toContain('getPublicUrl,');
    expect(clientSrc).toContain('isConnected');
  });

  it('should report status: connecting, connected, disconnected, reconnecting, error, provisioning', () => {
    expect(clientSrc).toContain("'connecting'");
    expect(clientSrc).toContain("'connected'");
    expect(clientSrc).toContain("'disconnected'");
    expect(clientSrc).toContain("'reconnecting'");
    expect(clientSrc).toContain("'error'");
    expect(clientSrc).toContain("'provisioning'");
  });

  it('should timeout and restart if not connected in 30s', () => {
    expect(clientSrc).toContain('30000');
    expect(clientSrc).toContain('Connection timeout');
  });
});

// ═══════════════════════════════════════════════════
// Legacy Relay (still in codebase, not used by named tunnels)
// ═══════════════════════════════════════════════════

describe('Tunnel: Legacy relay (cloud)', () => {
  const registrySrc = fs.readFileSync(path.resolve('cloud/tunnel-registry.js'), 'utf8');
  const serverSrc = fs.readFileSync(path.resolve('cloud/server.js'), 'utf8');

  it('should create tunnels table in SQLite', () => {
    expect(registrySrc).toContain('CREATE TABLE IF NOT EXISTS tunnels');
  });

  it('should have POST /tunnel/register route', () => {
    expect(serverSrc).toContain("'/tunnel/register'");
  });

  it('should have proxy route at /t/:tunnelId/*', () => {
    expect(serverSrc).toContain("'/t/:tunnelId/*'");
  });
});

// ═══════════════════════════════════════════════════
// Zero Infrastructure for Users
// ═══════════════════════════════════════════════════

describe('Tunnel: Zero infrastructure for users', () => {
  it('should not use WebSocket relay', () => {
    expect(clientSrc).not.toContain('WebSocketServer');
    expect(clientSrc).not.toContain('wss://');
  });

  it('should not reference Fly.io', () => {
    expect(clientSrc).not.toContain('fly.io');
    expect(clientSrc).not.toContain('fly.toml');
  });

  it('should not have a relay server directory', () => {
    expect(fs.existsSync(path.resolve('tunnel/relay/server.js'))).toBe(false);
  });

  it('should use cloudflared', () => {
    expect(clientSrc).toContain('cloudflared');
  });
});

// ═══════════════════════════════════════════════════
// Electron Integration
// ═══════════════════════════════════════════════════

describe('Tunnel: Electron integration', () => {
  it('should import tunnel module', () => {
    expect(mainSrc).toContain("require('./tunnel')");
  });

  it('should start tunnel for ALL users (no plan gating)', () => {
    expect(mainSrc).toContain('tunnel.start');
    expect(mainSrc).not.toContain("plan !== 'free'");
    expect(mainSrc).not.toContain('gated: true');
  });

  it('should stop tunnel on quit', () => {
    expect(mainSrc).toContain('tunnel.stop()');
  });

  it('should expose tunnel IPC handlers', () => {
    expect(mainSrc).toContain("'tunnel:getStatus'");
    expect(mainSrc).toContain("'tunnel:copyUrl'");
    expect(mainSrc).toContain("'tunnel:restart'");
  });

  it('should push status updates to renderer', () => {
    expect(mainSrc).toContain("mainWindow.webContents.send('tunnel:status'");
  });
});

describe('Tunnel: Preload bridge', () => {
  it('should expose tunnel.getStatus', () => {
    expect(preloadSrc).toContain("getStatus: () => ipcRenderer.invoke('tunnel:getStatus')");
  });

  it('should expose tunnel.copyUrl', () => {
    expect(preloadSrc).toContain("copyUrl: () => ipcRenderer.invoke('tunnel:copyUrl')");
  });

  it('should expose tunnel.restart', () => {
    expect(preloadSrc).toContain("restart: () => ipcRenderer.invoke('tunnel:restart')");
  });

  it('should expose tunnel.onStatus listener', () => {
    expect(preloadSrc).toContain("ipcRenderer.on('tunnel:status'");
  });
});

// ═══════════════════════════════════════════════════
// Landing Page
// ═══════════════════════════════════════════════════

describe('Tunnel: Landing page', () => {
  const html = fs.readFileSync(path.resolve('site/index.html'), 'utf8');

  it('should not mention Fly.io', () => {
    expect(html.toLowerCase()).not.toContain('fly.io');
  });
});
