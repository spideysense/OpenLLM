const http = require('http');
const apikeys = require('./apikeys');
const aliases = require('./aliases');

const OLLAMA_HOST = '127.0.0.1';
const OLLAMA_PORT = 11434;
const DEFAULT_PORT = 4000;

let server = null;
let currentPort = DEFAULT_PORT;

// ═══════════════════════════════════════════════════
// Gateway Server
// ═══════════════════════════════════════════════════

function start() {
  if (server) return;

  server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // ── Auth check ──
    const keys = apikeys.listKeys();
    if (keys.length > 0) {
      const authHeader = req.headers['authorization'] || '';
      const token = authHeader.replace(/^Bearer\s+/i, '');
      if (!apikeys.validateKey(token)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Invalid API key', type: 'authentication_error' } }));
        return;
      }
      // Update last-used timestamp
      apikeys.touchKey(token);
    }

    // ── Read body ──
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      // ── Model aliasing ──
      if (body) {
        try {
          const parsed = JSON.parse(body);
          if (parsed.model) {
            const resolved = aliases.resolve(parsed.model);
            if (resolved !== parsed.model) {
              parsed.model = resolved;
              body = JSON.stringify(parsed);
            }
          }
        } catch {
          // Not JSON or no model field — pass through
        }
      }

      // ── Proxy to Ollama ──
      // Map OpenAI-style routes to Ollama
      let ollamaPath = req.url;

      // GET /v1/models → Ollama /api/tags + alias info
      if (req.url === '/v1/models' && req.method === 'GET') {
        handleListModels(res);
        return;
      }

      // POST /v1/chat/completions → Ollama /v1/chat/completions (native support)
      // Ollama already handles /v1/* routes natively

      const proxyReq = http.request(
        {
          hostname: OLLAMA_HOST,
          port: OLLAMA_PORT,
          path: ollamaPath,
          method: req.method,
          headers: {
            ...req.headers,
            host: `${OLLAMA_HOST}:${OLLAMA_PORT}`,
            'content-length': Buffer.byteLength(body),
          },
        },
        (proxyRes) => {
          // Detect streaming vs non-streaming response.
          // When stream:false, Ollama sets transfer-encoding:chunked but sends one
          // JSON blob — piping those headers to the caller breaks Vercel/fetch clients
          // that expect Content-Length. Buffer and re-send with correct headers.
          const isStreaming = req.method === 'POST' &&
            (req.url.includes('chat/completions') || req.url.includes('completions')) &&
            (() => { try { return JSON.parse(body).stream !== false; } catch { return true; } })();

          if (!isStreaming) {
            // Buffer the full response, set Content-Length, strip chunked encoding
            const chunks = [];
            proxyRes.on('data', c => chunks.push(c));
            proxyRes.on('end', () => {
              const buf = Buffer.concat(chunks);
              const headers = { ...proxyRes.headers };
              delete headers['transfer-encoding'];
              headers['content-length'] = String(buf.length);
              res.writeHead(proxyRes.statusCode, headers);
              res.end(buf);
            });
          } else {
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            proxyRes.pipe(res, { end: true });
          }
        }
      );

      proxyReq.on('error', (err) => {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: { message: 'Cannot reach Ollama. Is it running?', type: 'proxy_error' },
        }));
      });

      proxyReq.write(body);
      proxyReq.end();
    });
  });

  // Try to bind to port, increment if busy
  tryListen(currentPort);
}

function tryListen(port) {
  server.listen(port, '127.0.0.1', () => {
    currentPort = port;
    console.log(`[Monet] API Gateway running on http://127.0.0.1:${port}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && port < DEFAULT_PORT + 10) {
      console.log(`[Monet] Port ${port} busy, trying ${port + 1}`);
      tryListen(port + 1);
    }
  });
}

function stop() {
  if (server) {
    server.close();
    server = null;
  }
}

// ═══════════════════════════════════════════════════
// Custom /v1/models endpoint (includes aliases)
// ═══════════════════════════════════════════════════

async function handleListModels(res) {
  try {
    const ollamaRes = await fetch(`http://${OLLAMA_HOST}:${OLLAMA_PORT}/api/tags`);
    const data = await ollamaRes.json();
    const ollamaModels = data.models || [];

    // Convert to OpenAI format
    const modelList = ollamaModels.map((m) => ({
      id: m.name,
      object: 'model',
      created: new Date(m.modified_at).getTime() / 1000,
      owned_by: 'local',
    }));

    // Add active aliases
    const activeAliases = aliases.getAliases();
    const installedNames = ollamaModels.map((m) => m.name);

    for (const [alias, target] of Object.entries(activeAliases)) {
      if (installedNames.some((n) => n === target || n.startsWith(target))) {
        modelList.push({
          id: alias,
          object: 'model',
          created: Date.now() / 1000,
          owned_by: 'monet-alias',
          _alias_target: target,
        });
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: modelList }));
  } catch {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Cannot reach Ollama' } }));
  }
}

function getPort() {
  return currentPort;
}

function getStatus() {
  return {
    running: !!server,
    port: currentPort,
    url: `http://localhost:${currentPort}/v1`,
  };
}

module.exports = { start, stop, getPort, getStatus };
