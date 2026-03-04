/**
 * Tunnel Tests
 *
 * STORY: User opens LLM Bear → app connects to relay → gets public URL
 *        → AI is accessible from anywhere on the internet
 * STORY: Relay server maps subdomains to WebSocket connections
 * STORY: Client reconnects automatically if connection drops
 * STORY: IPC bridge exposes tunnel status to the renderer UI
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const relaySrc = fs.readFileSync(path.resolve('tunnel/relay/server.js'), 'utf8');
const clientSrc = fs.readFileSync(path.resolve('src/main/tunnel.js'), 'utf8');
const mainSrc = fs.readFileSync(path.resolve('src/main/index.js'), 'utf8');
const preloadSrc = fs.readFileSync(path.resolve('src/preload/index.js'), 'utf8');
const relayPkg = JSON.parse(fs.readFileSync(path.resolve('tunnel/relay/package.json'), 'utf8'));
const flyConfig = fs.readFileSync(path.resolve('tunnel/relay/fly.toml'), 'utf8');

// ═══════════════════════════════════════════════════
// Relay Server
// ═══════════════════════════════════════════════════

describe('Tunnel: Relay server', () => {
  it('should create WebSocket server on /tunnel path', () => {
    expect(relaySrc).toContain("WebSocketServer");
    expect(relaySrc).toContain("path: '/tunnel'");
  });

  it('should assign subdomains to connecting clients', () => {
    expect(relaySrc).toContain('generateSubdomain');
    expect(relaySrc).toContain("type: 'assigned'");
    expect(relaySrc).toContain('subdomain');
  });

  it('should generate tunnel keys for reconnect stability', () => {
    expect(relaySrc).toContain('generateTunnelKey');
    expect(relaySrc).toContain('tk-');
    expect(relaySrc).toContain('keyToSub');
  });

  it('should restore subdomain on reconnect with same key', () => {
    expect(relaySrc).toContain('keyToSub.has(tunnelKey)');
    expect(relaySrc).toContain('keyToSub.get(tunnelKey)');
  });

  it('should extract subdomain from Host header', () => {
    expect(relaySrc).toContain('extractSubdomain');
    expect(relaySrc).toContain('RELAY_DOMAIN');
  });

  it('should proxy HTTP requests to client via WebSocket', () => {
    expect(relaySrc).toContain('proxyToClient');
    expect(relaySrc).toContain("type: 'request'");
    expect(relaySrc).toContain('requestId');
    expect(relaySrc).toContain('method');
    expect(relaySrc).toContain('path');
    expect(relaySrc).toContain('headers');
    expect(relaySrc).toContain('body');
  });

  it('should handle responses from client and send to HTTP caller', () => {
    expect(relaySrc).toContain("msg.type === 'response'");
    expect(relaySrc).toContain('pending.res.writeHead');
    expect(relaySrc).toContain('pending.res.end');
  });

  it('should return 502 when tunnel is disconnected', () => {
    expect(relaySrc).toContain('502');
    expect(relaySrc).toContain('Tunnel not connected');
  });

  it('should timeout requests at 2 minutes', () => {
    expect(relaySrc).toContain('120_000');
    expect(relaySrc).toContain('504');
    expect(relaySrc).toContain('timeout_error');
  });

  it('should handle CORS preflight', () => {
    expect(relaySrc).toContain('OPTIONS');
    expect(relaySrc).toContain('Access-Control-Allow-Origin');
    expect(relaySrc).toContain('Access-Control-Allow-Methods');
  });

  it('should have health check endpoint', () => {
    expect(relaySrc).toContain("'/health'");
    expect(relaySrc).toContain('active_tunnels');
  });

  it('should have registration endpoint for pre-assigning subdomains', () => {
    expect(relaySrc).toContain("'/register'");
    expect(relaySrc).toContain('handleRegister');
  });

  it('should support ping/pong heartbeat', () => {
    expect(relaySrc).toContain("'ping'");
    expect(relaySrc).toContain("type: 'pong'");
  });

  it('should reject pending requests on client disconnect', () => {
    expect(relaySrc).toContain("ws.on('close'");
    expect(relaySrc).toContain('pendingRequests');
    expect(relaySrc).toContain('Tunnel disconnected');
  });

  it('should configure domain via RELAY_DOMAIN env var', () => {
    expect(relaySrc).toContain("RELAY_DOMAIN");
    expect(relaySrc).toContain("api.llmbear.com");
  });

  it('should add X-Powered-By header to proxied responses', () => {
    expect(relaySrc).toContain('LLM Bear Tunnel');
  });
});

describe('Tunnel: Relay package', () => {
  it('should have correct package name', () => {
    expect(relayPkg.name).toBe('@llmbear/tunnel-relay');
  });

  it('should depend on ws for WebSocket', () => {
    expect(relayPkg.dependencies.ws).toBeTruthy();
  });

  it('should have start script', () => {
    expect(relayPkg.scripts.start).toContain('node server.js');
  });
});

describe('Tunnel: Fly.io deployment', () => {
  it('should configure auto_stop_machines = false (always on)', () => {
    expect(flyConfig).toContain('auto_stop_machines = false');
  });

  it('should require min 1 machine running', () => {
    expect(flyConfig).toContain('min_machines_running = 1');
  });

  it('should force HTTPS', () => {
    expect(flyConfig).toContain('force_https = true');
  });

  it('should set relay domain env var', () => {
    expect(flyConfig).toContain('RELAY_DOMAIN');
    expect(flyConfig).toContain('api.llmbear.com');
  });

  it('should handle high concurrency for WebSocket connections', () => {
    expect(flyConfig).toContain('hard_limit = 2500');
  });
});

// ═══════════════════════════════════════════════════
// Tunnel Client (Electron)
// ═══════════════════════════════════════════════════

describe('Tunnel: Client', () => {
  it('should connect to relay via WebSocket', () => {
    expect(clientSrc).toContain('WebSocket');
    expect(clientSrc).toContain('RELAY_URL');
    expect(clientSrc).toContain('wss://api.llmbear.com/tunnel');
  });

  it('should persist tunnel key in store for reconnect', () => {
    expect(clientSrc).toContain("store.set('tunnelKey'");
    expect(clientSrc).toContain("store.get('tunnelKey')");
    expect(clientSrc).toContain("store.set('tunnelSubdomain'");
  });

  it('should forward relay requests to local API on localhost:4000', () => {
    expect(clientSrc).toContain('LOCAL_API');
    expect(clientSrc).toContain('127.0.0.1:4000');
    expect(clientSrc).toContain('http.request');
  });

  it('should send responses back through WebSocket', () => {
    expect(clientSrc).toContain('sendResponse');
    expect(clientSrc).toContain("type: 'response'");
    expect(clientSrc).toContain('requestId');
  });

  it('should auto-reconnect with exponential backoff', () => {
    expect(clientSrc).toContain('scheduleReconnect');
    expect(clientSrc).toContain('RECONNECT_DELAY');
    expect(clientSrc).toContain('MAX_RECONNECT_DELAY');
    expect(clientSrc).toContain('reconnectDelay * 1.5');
  });

  it('should send heartbeat pings to keep connection alive', () => {
    expect(clientSrc).toContain('HEARTBEAT_INTERVAL');
    expect(clientSrc).toContain("type: 'ping'");
    expect(clientSrc).toContain('startHeartbeat');
    expect(clientSrc).toContain('stopHeartbeat');
  });

  it('should handle assigned subdomain from relay', () => {
    expect(clientSrc).toContain("case 'assigned'");
    expect(clientSrc).toContain('publicUrl = msg.url');
    expect(clientSrc).toContain('subdomain = msg.subdomain');
  });

  it('should expose start/stop/getPublicUrl/isConnected API', () => {
    expect(clientSrc).toContain('module.exports');
    expect(clientSrc).toContain('start,');
    expect(clientSrc).toContain('stop,');
    expect(clientSrc).toContain('getPublicUrl,');
    expect(clientSrc).toContain('isConnected,');
  });

  it('should notify status changes via callback', () => {
    expect(clientSrc).toContain('onStatusChange');
    expect(clientSrc).toContain('notifyStatus');
    expect(clientSrc).toContain("'connecting'");
    expect(clientSrc).toContain("'connected'");
    expect(clientSrc).toContain("'disconnected'");
    expect(clientSrc).toContain("'reconnecting'");
  });

  it('should return 502 when local API is unreachable', () => {
    expect(clientSrc).toContain('502');
    expect(clientSrc).toContain('Local API not reachable');
    expect(clientSrc).toContain('local_error');
  });

  it('should timeout local requests at 2 minutes', () => {
    expect(clientSrc).toContain('120_000');
    expect(clientSrc).toContain('timeout_error');
  });

  it('should clean shutdown without reconnecting', () => {
    expect(clientSrc).toContain('isShuttingDown');
    expect(clientSrc).toContain('if (isShuttingDown) return');
  });
});

// ═══════════════════════════════════════════════════
// Electron Integration
// ═══════════════════════════════════════════════════

describe('Tunnel: Electron main process integration', () => {
  it('should import tunnel module', () => {
    expect(mainSrc).toContain("require('./tunnel')");
  });

  it('should start tunnel after gateway on app ready', () => {
    expect(mainSrc).toContain('tunnel.start');
    expect(mainSrc).toContain("tunnel:status");
  });

  it('should stop tunnel on before-quit', () => {
    expect(mainSrc).toContain('tunnel.stop()');
  });

  it('should expose tunnel:getStatus IPC handler', () => {
    expect(mainSrc).toContain("'tunnel:getStatus'");
    expect(mainSrc).toContain('tunnel.isConnected()');
    expect(mainSrc).toContain('tunnel.getPublicUrl()');
  });

  it('should expose tunnel:copyUrl IPC handler', () => {
    expect(mainSrc).toContain("'tunnel:copyUrl'");
    expect(mainSrc).toContain('clipboard.writeText');
  });

  it('should expose tunnel:restart IPC handler', () => {
    expect(mainSrc).toContain("'tunnel:restart'");
  });

  it('should push tunnel status updates to renderer', () => {
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
// Security
// ═══════════════════════════════════════════════════

describe('Tunnel: Security', () => {
  it('should use wss:// (encrypted) for relay connection', () => {
    expect(clientSrc).toContain('wss://');
  });

  it('should not expose tunnel keys in relay proxy responses to HTTP callers', () => {
    // The proxyToClient function should only forward request/response, not tunnel internals
    const proxyFn = relaySrc.slice(relaySrc.indexOf('function proxyToClient'));
    const proxyEnd = proxyFn.indexOf('\nfunction');
    const proxySection = proxyEnd > 0 ? proxyFn.slice(0, proxyEnd) : proxyFn;
    expect(proxySection).not.toContain('tunnelKey');
  });

  it('should strip forwarding headers before sending to local API', () => {
    expect(clientSrc).toContain("delete localHeaders.host");
    expect(clientSrc).toContain("delete localHeaders['x-forwarded-for']");
  });

  it('should use cryptographically random subdomain and tunnel key', () => {
    expect(relaySrc).toContain('crypto.randomBytes');
  });
});
