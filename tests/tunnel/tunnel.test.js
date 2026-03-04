/**
 * Tunnel Tests — Cloudflare Quick Tunnel
 *
 * STORY: User opens LLM Bear → app downloads cloudflared → starts tunnel
 *        → gets free public URL → AI accessible from anywhere
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
  it('should store binary in ~/.llmbear/bin/', () => {
    expect(clientSrc).toContain('.llmbear');
    expect(clientSrc).toContain('bin');
    expect(clientSrc).toContain('getBinaryDir');
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

  it('should extract tgz for macOS downloads', () => {
    expect(clientSrc).toContain('.tgz');
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
// Tunnel Process
// ═══════════════════════════════════════════════════

describe('Tunnel: Cloudflare process', () => {
  it('should spawn cloudflared with correct args', () => {
    expect(clientSrc).toContain('spawn');
    expect(clientSrc).toContain("'tunnel'");
    expect(clientSrc).toContain("'--url'");
    expect(clientSrc).toContain('LOCAL_API');
    expect(clientSrc).toContain("'--no-autoupdate'");
  });

  it('should default to localhost:4000', () => {
    expect(clientSrc).toContain('http://localhost:4000');
  });

  it('should parse trycloudflare.com URL from output', () => {
    expect(clientSrc).toContain('trycloudflare.com');
    expect(clientSrc).toContain('.match(');
  });

  it('should parse URL from both stdout and stderr', () => {
    expect(clientSrc).toContain("proc.stderr.on('data'");
    expect(clientSrc).toContain("proc.stdout.on('data'");
  });

  it('should save last tunnel URL to store', () => {
    expect(clientSrc).toContain("store.set('lastTunnelUrl'");
  });

  it('should auto-reconnect with exponential backoff', () => {
    expect(clientSrc).toContain('scheduleReconnect');
    expect(clientSrc).toContain('RECONNECT_DELAY');
    expect(clientSrc).toContain('MAX_RECONNECT_DELAY');
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
    expect(clientSrc).toContain('isConnected,');
  });

  it('should report status: connecting, connected, disconnected, reconnecting, error', () => {
    expect(clientSrc).toContain("'connecting'");
    expect(clientSrc).toContain("'connected'");
    expect(clientSrc).toContain("'disconnected'");
    expect(clientSrc).toContain("'reconnecting'");
    expect(clientSrc).toContain("'error'");
  });
});

// ═══════════════════════════════════════════════════
// No Custom Relay Server
// ═══════════════════════════════════════════════════

describe('Tunnel: Zero infrastructure', () => {
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

  it('should use Cloudflare — zero cost to developer', () => {
    expect(clientSrc).toContain('cloudflared');
    expect(clientSrc).toContain('trycloudflare.com');
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
    // Should NOT have plan gating
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

  it('should show public URL in code examples', () => {
    expect(html).toContain('trycloudflare.com');
  });

  it('should list public URL as a Cave Bear feature', () => {
    // Find the pricing section by looking for the pricing features list near "Cave Bear"
    const pricingSection = html.slice(html.indexOf('id="pricing"'));
    const caveBearStart = pricingSection.indexOf('Cave Bear');
    const cloudBearStart = pricingSection.indexOf('Cloud Bear');
    const caveBearSection = pricingSection.slice(caveBearStart, cloudBearStart);
    expect(caveBearSection).toContain('Public URL');
    expect(caveBearSection).not.toContain('No public URL');
  });

  it('should mention Cloudflare in privacy note', () => {
    expect(html).toContain('Cloudflare');
  });

  it('should not mention Fly.io', () => {
    expect(html.toLowerCase()).not.toContain('fly.io');
  });
});
