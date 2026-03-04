const http = require('http');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = process.env.PORT || 4002;
const RELAY_DOMAIN = process.env.RELAY_DOMAIN || 'api.llmbear.com';

// ═══════════════════════════════════════════════════
// Client Registry — maps subdomain → WebSocket
// ═══════════════════════════════════════════════════

const clients = new Map();       // subdomain → { ws, pendingRequests }
const keyToSub = new Map();      // apiKey → subdomain (for reconnect stability)

function generateSubdomain() {
  // Short, memorable, collision-resistant: 8 hex chars
  return crypto.randomBytes(4).toString('hex');
}

function generateTunnelKey() {
  return 'tk-' + crypto.randomBytes(16).toString('base64url');
}

// ═══════════════════════════════════════════════════
// HTTP Server — handles both upgrade (WS) and proxy (HTTP)
// ═══════════════════════════════════════════════════

const server = http.createServer((req, res) => {
  // Extract subdomain from Host header
  const host = req.headers.host || '';
  const subdomain = extractSubdomain(host);

  // Health check at root domain
  if (!subdomain || host === RELAY_DOMAIN) {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        status: 'ok',
        service: 'llmbear-tunnel-relay',
        active_tunnels: clients.size,
      }));
    }
    if (req.url === '/register') {
      return handleRegister(req, res);
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'No tunnel found. Visit https://llmbear.com to get started.' }));
  }

  // Proxy request to the right client
  proxyToClient(subdomain, req, res);
});

// ═══════════════════════════════════════════════════
// WebSocket — tunnel connections from desktop clients
// ═══════════════════════════════════════════════════

const wss = new WebSocketServer({ server, path: '/tunnel' });

wss.on('connection', (ws, req) => {
  const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
  const tunnelKey = params.get('key');
  const requestedSub = params.get('subdomain');

  let subdomain;

  // If client has a tunnel key, try to restore their subdomain
  if (tunnelKey && keyToSub.has(tunnelKey)) {
    subdomain = keyToSub.get(tunnelKey);
    // Disconnect old socket if still connected
    if (clients.has(subdomain)) {
      const old = clients.get(subdomain);
      if (old.ws.readyState === WebSocket.OPEN) old.ws.close();
    }
  } else if (requestedSub && !clients.has(requestedSub)) {
    subdomain = requestedSub;
  } else {
    subdomain = generateSubdomain();
  }

  const newKey = tunnelKey || generateTunnelKey();
  keyToSub.set(newKey, subdomain);

  const client = {
    ws,
    pendingRequests: new Map(), // requestId → { res, timeout }
    subdomain,
    tunnelKey: newKey,
    connectedAt: new Date().toISOString(),
  };

  clients.set(subdomain, client);

  // Send assignment
  ws.send(JSON.stringify({
    type: 'assigned',
    subdomain,
    tunnelKey: newKey,
    url: `https://${subdomain}.${RELAY_DOMAIN}`,
  }));

  console.log(`[Tunnel] Connected: ${subdomain}.${RELAY_DOMAIN} (${clients.size} active)`);

  // Handle responses from client
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'response' && msg.requestId) {
        const pending = client.pendingRequests.get(msg.requestId);
        if (pending) {
          clearTimeout(pending.timeout);
          client.pendingRequests.delete(msg.requestId);

          const headers = msg.headers || {};
          headers['X-Powered-By'] = 'LLM Bear Tunnel';
          headers['Access-Control-Allow-Origin'] = '*';

          pending.res.writeHead(msg.status || 200, headers);
          pending.res.end(msg.body || '');
        }
      } else if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    } catch (e) {
      console.error('[Tunnel] Bad message from client:', e.message);
    }
  });

  ws.on('close', () => {
    // Reject all pending requests
    for (const [id, pending] of client.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.res.writeHead(502, { 'Content-Type': 'application/json' });
      pending.res.end(JSON.stringify({ error: { message: 'Tunnel disconnected. The LLM Bear app may have closed.', type: 'tunnel_error' } }));
    }
    clients.delete(subdomain);
    console.log(`[Tunnel] Disconnected: ${subdomain} (${clients.size} active)`);
  });

  ws.on('error', (err) => {
    console.error(`[Tunnel] WS error for ${subdomain}:`, err.message);
  });
});

// ═══════════════════════════════════════════════════
// Registration (pre-assign subdomain via HTTP for first-time setup)
// ═══════════════════════════════════════════════════

function handleRegister(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405);
    return res.end('POST only');
  }

  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const subdomain = generateSubdomain();
    const tunnelKey = generateTunnelKey();
    keyToSub.set(tunnelKey, subdomain);

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({
      subdomain,
      tunnelKey,
      url: `https://${subdomain}.${RELAY_DOMAIN}`,
      websocket: `wss://${RELAY_DOMAIN}/tunnel?key=${tunnelKey}&subdomain=${subdomain}`,
    }));
    console.log(`[Tunnel] Pre-registered: ${subdomain}`);
  });
}

// ═══════════════════════════════════════════════════
// Proxy — forward HTTP request to desktop client via WS
// ═══════════════════════════════════════════════════

function extractSubdomain(host) {
  // "abc123.api.llmbear.com" → "abc123"
  if (!host.endsWith('.' + RELAY_DOMAIN)) return null;
  return host.slice(0, host.length - RELAY_DOMAIN.length - 1);
}

function proxyToClient(subdomain, req, res) {
  const client = clients.get(subdomain);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    });
    return res.end();
  }

  if (!client || client.ws.readyState !== WebSocket.OPEN) {
    res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({
      error: {
        message: 'Tunnel not connected. Make sure LLM Bear is running on the target machine.',
        type: 'tunnel_error',
        subdomain,
      }
    }));
  }

  // Collect request body
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const requestId = crypto.randomUUID();
    const body = Buffer.concat(chunks).toString();

    // Set timeout for response (30s)
    const timeout = setTimeout(() => {
      client.pendingRequests.delete(requestId);
      res.writeHead(504, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: { message: 'Tunnel timeout — the local model may be processing a long request.', type: 'timeout_error' } }));
    }, 120_000); // 2 minute timeout for LLM responses

    client.pendingRequests.set(requestId, { res, timeout });

    // Forward to client via WebSocket
    client.ws.send(JSON.stringify({
      type: 'request',
      requestId,
      method: req.method,
      path: req.url,
      headers: req.headers,
      body,
    }));
  });
}

// ═══════════════════════════════════════════════════
// Cleanup stale key mappings every hour
// ═══════════════════════════════════════════════════

setInterval(() => {
  for (const [key, sub] of keyToSub) {
    if (!clients.has(sub)) {
      // Keep mappings for 24 hours after disconnect (for reconnect)
      // In production, add timestamps. For now, keep all.
    }
  }
}, 3600_000);

// ═══════════════════════════════════════════════════
// Start
// ═══════════════════════════════════════════════════

server.listen(PORT, () => {
  console.log(`🐻 LLM Bear Tunnel Relay on port ${PORT}`);
  console.log(`   Domain: *.${RELAY_DOMAIN}`);
  console.log(`   WebSocket: wss://${RELAY_DOMAIN}/tunnel`);
  console.log(`   Health: http://localhost:${PORT}/health`);
});

module.exports = server;
