/**
 * LLM Bear Tunnel Client
 *
 * Runs inside the Electron main process. On app start:
 * 1. Connects to the tunnel relay via WebSocket
 * 2. Gets assigned a public URL: https://abc123.api.llmbear.com
 * 3. Receives HTTP requests from the relay, forwards to localhost:4000
 * 4. Sends responses back through the WebSocket
 *
 * The result: user's local AI models are accessible from anywhere.
 */

const WebSocket = require('ws');
const http = require('http');
const store = require('./store');

const RELAY_URL = process.env.LLMBEAR_RELAY || 'wss://api.llmbear.com/tunnel';
const LOCAL_API = process.env.LLMBEAR_LOCAL_API || 'http://127.0.0.1:4000';
const RECONNECT_DELAY = 3000;
const MAX_RECONNECT_DELAY = 30000;
const HEARTBEAT_INTERVAL = 25000;

let ws = null;
let publicUrl = null;
let subdomain = null;
let tunnelKey = store.get('tunnelKey') || null;
let reconnectDelay = RECONNECT_DELAY;
let heartbeatTimer = null;
let isShuttingDown = false;

// Callbacks for UI updates
let onStatusChange = null;

// ═══════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════

function start(statusCallback) {
  onStatusChange = statusCallback || (() => {});
  isShuttingDown = false;
  connect();
}

function stop() {
  isShuttingDown = true;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (ws) {
    ws.close();
    ws = null;
  }
  publicUrl = null;
  subdomain = null;
  notifyStatus('disconnected');
}

function getPublicUrl() {
  return publicUrl;
}

function getSubdomain() {
  return subdomain;
}

function isConnected() {
  return ws && ws.readyState === WebSocket.OPEN;
}

// ═══════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════

function connect() {
  if (isShuttingDown) return;

  const params = new URLSearchParams();
  if (tunnelKey) params.set('key', tunnelKey);
  if (subdomain) params.set('subdomain', subdomain);

  const url = `${RELAY_URL}?${params}`;

  notifyStatus('connecting');

  try {
    ws = new WebSocket(url);
  } catch (err) {
    console.error('[Tunnel] Connection error:', err.message);
    scheduleReconnect();
    return;
  }

  ws.on('open', () => {
    console.log('[Tunnel] Connected to relay');
    reconnectDelay = RECONNECT_DELAY; // Reset backoff
    startHeartbeat();
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      handleMessage(msg);
    } catch (e) {
      console.error('[Tunnel] Bad message:', e.message);
    }
  });

  ws.on('close', () => {
    console.log('[Tunnel] Disconnected');
    stopHeartbeat();
    publicUrl = null;
    notifyStatus('disconnected');
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    console.error('[Tunnel] WebSocket error:', err.message);
  });
}

function scheduleReconnect() {
  if (isShuttingDown) return;
  notifyStatus('reconnecting');
  setTimeout(() => connect(), reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT_DELAY);
}

// ═══════════════════════════════════════════════════
// Message handling
// ═══════════════════════════════════════════════════

function handleMessage(msg) {
  switch (msg.type) {
    case 'assigned':
      subdomain = msg.subdomain;
      tunnelKey = msg.tunnelKey;
      publicUrl = msg.url;
      store.set('tunnelKey', tunnelKey);
      store.set('tunnelSubdomain', subdomain);
      console.log(`[Tunnel] Public URL: ${publicUrl}`);
      notifyStatus('connected', { url: publicUrl, subdomain });
      break;

    case 'request':
      handleProxyRequest(msg);
      break;

    case 'pong':
      // Heartbeat response, all good
      break;
  }
}

// ═══════════════════════════════════════════════════
// Proxy — forward relay request to local API
// ═══════════════════════════════════════════════════

function handleProxyRequest(msg) {
  const { requestId, method, path, headers, body } = msg;

  // Strip tunnel-specific headers, forward to local API
  const localHeaders = { ...headers };
  delete localHeaders.host;
  delete localHeaders['x-forwarded-for'];
  delete localHeaders['x-forwarded-proto'];
  localHeaders.host = new URL(LOCAL_API).host;

  const url = new URL(path, LOCAL_API);

  const options = {
    method,
    hostname: url.hostname,
    port: url.port,
    path: url.pathname + url.search,
    headers: localHeaders,
    timeout: 120_000, // 2 min for LLM responses
  };

  const proxyReq = http.request(options, (proxyRes) => {
    const chunks = [];
    proxyRes.on('data', (c) => chunks.push(c));
    proxyRes.on('end', () => {
      const responseBody = Buffer.concat(chunks).toString();

      // Clean up response headers
      const resHeaders = { ...proxyRes.headers };
      delete resHeaders['transfer-encoding']; // We're sending the full body

      sendResponse(requestId, proxyRes.statusCode, resHeaders, responseBody);
    });
  });

  proxyReq.on('error', (err) => {
    console.error(`[Tunnel] Local API error: ${err.message}`);
    sendResponse(requestId, 502, { 'Content-Type': 'application/json' },
      JSON.stringify({
        error: {
          message: 'Local API not reachable. Make sure Ollama is running.',
          type: 'local_error',
          detail: err.message,
        }
      })
    );
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    sendResponse(requestId, 504, { 'Content-Type': 'application/json' },
      JSON.stringify({
        error: { message: 'Local model timed out.', type: 'timeout_error' }
      })
    );
  });

  if (body) proxyReq.write(body);
  proxyReq.end();
}

function sendResponse(requestId, status, headers, body) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  ws.send(JSON.stringify({
    type: 'response',
    requestId,
    status,
    headers,
    body,
  }));
}

// ═══════════════════════════════════════════════════
// Heartbeat
// ═══════════════════════════════════════════════════

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, HEARTBEAT_INTERVAL);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
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
  getSubdomain,
  isConnected,
};
