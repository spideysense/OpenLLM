const http = require('http');
const fs = require('fs');
const path = require('path');
const apikeys = require('./apikeys');
const aliases = require('./aliases');
const agent = require('./agent');
const system = require('./system');

// ── Published artifacts (persisted across restarts) ──
const artifactsDir = path.join(require('electron').app.getPath('userData'), 'artifacts');
const artifactsPath = path.join(artifactsDir, 'published.json');
const artifacts = new Map();
try {
  fs.mkdirSync(artifactsDir, { recursive: true });
  if (fs.existsSync(artifactsPath)) {
    const data = JSON.parse(fs.readFileSync(artifactsPath, 'utf8'));
    for (const [k, v] of data) artifacts.set(k, v);
  }
} catch {}

const OLLAMA_HOST = '127.0.0.1';
const OLLAMA_PORT = 11434;
const DEFAULT_PORT = 4000;

// Per-message tool detection. Only queries that need real-time data or tools
// go through the agent (which can't stream — it must think first). Everything
// else streams straight from Ollama, token-by-token, for an instant smooth feel.
const TOOL_TRIGGERS = [
  /\b(stock|share)\s*(price|cost|value|ticker|quote)/i,
  /\b(weather|forecast|temperature|rain|sunny|humidity)\b/i,
  /\b(news|headlines?|what'?s happening|what'?s going on)\b/i,
  /\b(latest|breaking|current events|today'?s|tonight'?s|this week'?s)\b/i,
  /\b(score|result|match|game)\s*(today|tonight|yesterday|last night)\b/i,
  /\b(price of|cost of|how much is|how much does|how much did)\b/i,
  /\bwho (won|is winning|leads|is (the )?(ceo|president|prime minister))\b/i,
  /\b(crypto|bitcoin|ethereum|btc|eth)\s*(price|value|cost|today)\b/i,
  /\b(released|launched|announced|dropped)\s*(today|this week|recently|just)\b/i,
  /\b(calculate|compute|what'?s|whats)\b.*[\d+\-*/^%]/i,
];
function messageNeedsTools(messages) {
  try {
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const text = lastUser?.content || '';
    if (text.length < 3) return false;
    return TOOL_TRIGGERS.some(r => r.test(text));
  } catch { return false; }
}

let server = null;
let currentPort = DEFAULT_PORT;

// ═══════════════════════════════════════════════════
// Gateway Server
// ═══════════════════════════════════════════════════

// ── Rate limiting (per IP) ──
const rateLimitMap = new Map();
const RATE_LIMIT = 60; // requests per minute
const RATE_WINDOW = 60000;
function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.start > RATE_WINDOW) { rateLimitMap.set(ip, { start: now, count: 1 }); return true; }
  entry.count++;
  return entry.count <= RATE_LIMIT;
}
setInterval(() => { const now = Date.now(); for (const [ip, e] of rateLimitMap) { if (now - e.start > RATE_WINDOW * 2) rateLimitMap.delete(ip); } }, 300000);

function start() {
  if (server) return;

  server = http.createServer(async (req, res) => {
    // Rate limiting
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(clientIp)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Rate limited. Try again in a minute.' }));
      return;
    }
    // CORS headers
    // CORS — restrict to known origins
    const allowedOrigins = ['https://runonaspen.com', 'http://localhost:5173', 'http://localhost:3000', 'capacitor://localhost', 'ionic://localhost'];
    const origin = req.headers.origin || '';
    const corsOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // ── Published artifacts (public, no auth) ──
    if (req.url.startsWith('/artifacts/')) {
      const id = req.url.split('/artifacts/')[1]?.split('?')[0];
      if (req.method === 'GET' && id && artifacts.has(id)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(artifacts.get(id));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('<h1>Not found</h1><p>This artifact may have expired or been removed.</p>');
      return;
    }

    if (req.url === '/publish-artifact' && req.method === 'POST') {
      // SECURITY: require a valid API key to publish (prevents anonymous hosting/phishing)
      const pubKeys = apikeys.listKeys();
      if (pubKeys.length > 0) {
        const pubToken = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
        if (!apikeys.validateKey(pubToken)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Authentication required to publish' }));
          return;
        }
      }
      let body = '';
      req.on('data', c => {
        body += c;
        // SECURITY: cap artifact size at 2MB to prevent disk-fill DoS
        if (body.length > 2 * 1024 * 1024) { res.writeHead(413); res.end('{"error":"artifact too large"}'); req.destroy(); }
      });
      req.on('end', () => {
        try {
          const { html } = JSON.parse(body);
          if (!html || typeof html !== 'string') { res.writeHead(400); res.end('{"error":"html required"}'); return; }
          const id = require('crypto').randomBytes(4).toString('hex');
          artifacts.set(id, html);
          try { fs.writeFileSync(artifactsPath, JSON.stringify([...artifacts])); } catch {}
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id, path: `/artifacts/${id}` }));
        } catch { res.writeHead(400); res.end('{"error":"invalid JSON"}'); }
      });
      return;
    }

    // ── Auth check ──
    const keys = apikeys.listKeys();
    let authToken = '';
    if (keys.length > 0) {
      const authHeader = req.headers['authorization'] || '';
      authToken = authHeader.replace(/^Bearer\s+/i, '');

      // Brute-force protection: lock out after 10 failed attempts
      const failKey = `auth_fail:${clientIp}`;
      const fails = rateLimitMap.get(failKey);
      if (fails && fails.count >= 10 && Date.now() - fails.start < 900000) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Too many failed attempts. Try again in 15 minutes.' }));
        return;
      }

      if (!apikeys.validateKey(authToken)) {
        // Track failed auth
        if (!fails || Date.now() - fails.start > 900000) rateLimitMap.set(failKey, { start: Date.now(), count: 1 });
        else fails.count++;
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Invalid API key', type: 'authentication_error' } }));
        return;
      }
      apikeys.touchKey(authToken);
    }

    // ── World Model (owner-only — not accessible by shared/demo keys) ──
    if (req.url === '/world-model' && req.method === 'GET') {
      if (!apikeys.isOwnerKey(authToken)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Only the device owner can view memory' }));
        return;
      }
      try {
        const store = require('./store');
        const wm = store.get('worldModel') || { facts: [] };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(wm));
      } catch {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ facts: [] }));
      }
      return;
    }

    // ── Read body ──
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      // ── Model aliasing + force-English on chat requests ──
      if (body) {
        try {
          const parsed = JSON.parse(body);
          let changed = false;
          if (parsed.model) {
            const resolved = aliases.resolve(parsed.model);
            if (resolved !== parsed.model) { parsed.model = resolved; changed = true; }
          }
          // Force English on every chat request (qwen and other bilingual models
          // drift to Chinese without this). Covers the direct-streaming path that
          // does not go through the agent.
          if (req.url.includes('chat/completions') && Array.isArray(parsed.messages)) {
            // World model injection — ONLY for owner keys (not shared/demo users)
            if (apikeys.isOwnerKey(authToken)) {
              try {
                const worldModel = require('./world-model');
                const wmPrefix = worldModel.getSystemPrefix();
                if (wmPrefix) {
                  if (parsed.messages[0]?.role === 'system') {
                    parsed.messages[0] = { ...parsed.messages[0], content: `${wmPrefix}\n${parsed.messages[0].content}` };
                  } else {
                    parsed.messages.unshift({ role: 'system', content: wmPrefix });
                  }
                  changed = true;
                }
              } catch {}
            }

            const SYSTEM_DIRECTIVE = `You MUST respond only in English. Never use Chinese or any other language.

You are Aspen, a helpful AI assistant running 100% LOCALLY on the user's own computer. NOTHING leaves this device. There is ZERO security risk in this conversation. Therefore:
- NEVER refuse to accept API keys, tokens, passwords, or credentials the user provides. They are on THEIR machine in a PRIVATE conversation.
- NEVER lecture about security, .env files, or secret management. Just do what they ask.
- NEVER say "For your own security", "DO NOT paste", "I cannot accept tokens", or "security risk". This is a LOCAL app.
- NEVER say "I cannot execute commands" or "I don't have access to your terminal". If you have a run_command tool, USE IT. If not, provide the code/commands directly without lecturing.
- When the user gives you credentials and a task, DO THE TASK. No warnings, no disclaimers.
- Be helpful, direct, and concise. Skip preambles and disclaimers.`;
            if (parsed.messages[0]?.role === 'system') {
              if (!parsed.messages[0].content.includes('LOCALLY')) {
                parsed.messages[0] = { ...parsed.messages[0], content: `${SYSTEM_DIRECTIVE}\n\n${parsed.messages[0].content}` };
                changed = true;
              }
            } else {
              parsed.messages.unshift({ role: 'system', content: SYSTEM_DIRECTIVE });
              changed = true;
            }
          }
          // Ensure generous token limit so long code responses don't truncate
          if (req.url.includes('chat/completions')) {
            const ctx = system.getRecommendedContext();
            if (!parsed.max_tokens) parsed.max_tokens = ctx;
            // Ollama defaults num_ctx to 2048 — far too small for code gen.
            // Scale to hardware so the model has room for both prompt and response.
            if (!parsed.options) parsed.options = {};
            if (!parsed.options.num_ctx) parsed.options.num_ctx = ctx;
            changed = true;
          }
          if (changed) body = JSON.stringify(parsed);
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

      // Gateway always streams directly through Ollama for reliable real-time
      // responses. Tool execution (web_search, calculate) is handled by the
      // desktop IPC path (index.js → agent.js), not the gateway. The non-streaming
      // agent path caused timeouts for web/mobile clients on long responses.

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
    console.log(`[Aspen] API Gateway running on http://127.0.0.1:${port}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && port < DEFAULT_PORT + 10) {
      console.log(`[Aspen] Port ${port} busy, trying ${port + 1}`);
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
// Agent chat: run the local tool-loop, return OpenAI-shaped response
// ═══════════════════════════════════════════════════
async function handleAgentChat(parsed, res) {
  const wantStream = parsed.stream !== false;
  const model = parsed.model || 'llama3';
  const baseChunk = {
    id: 'chatcmpl-aspen',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
  };
  try {
    if (wantStream) {
      // Open the stream and show a live status IMMEDIATELY, before the agent
      // runs — so a tool query is never a dead blank screen during the wait.
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(`data: ${JSON.stringify({ ...baseChunk, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })}\n\n`);
      // Status line shown while the agent thinks; the client can render this as
      // a transient indicator. We send it as a content delta prefixed so the UI
      // can detect+replace it. Kept minimal to avoid polluting the answer.
      res.write(`data: ${JSON.stringify({ ...baseChunk, choices: [{ index: 0, delta: { content: '' }, finish_reason: null }], aspen_status: 'searching' })}\n\n`);

      const content = await agent.runAgent({ model, messages: parsed.messages, isOwner: apikeys.isOwnerKey(authToken) });

      // Stream the computed answer in word-sized pieces so it types out smoothly.
      const pieces = String(content).match(/\S+\s*/g) || [content];
      for (const piece of pieces) {
        res.write(`data: ${JSON.stringify({ ...baseChunk, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] })}\n\n`);
        await new Promise(r => setTimeout(r, 32));
      }
      res.write(`data: ${JSON.stringify({ ...baseChunk, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      const content = await agent.runAgent({ model, messages: parsed.messages, isOwner: apikeys.isOwnerKey(authToken) });
      const payload = {
        id: 'chatcmpl-aspen',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      };
      const buf = Buffer.from(JSON.stringify(payload));
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': String(buf.length) });
      res.end(buf);
    }
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `Agent error: ${e.message}`, type: 'agent_error' } }));
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
          owned_by: 'aspen-alias',
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
