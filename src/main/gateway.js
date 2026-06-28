const http = require('http');
const fs = require('fs');
const path = require('path');
const apikeys = require('./apikeys');
const aliases = require('./aliases');
const agent = require('./agent');
const gatewayAgent = require('./gateway-agent');
const { ASPEN_ABOUT } = require('./aspen-facts');
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
    // Rate limiting. Prefer Cloudflare's cf-connecting-ip — the tunnel sets the
    // real client IP there and overwrites any client-supplied value. A plain
    // x-forwarded-for is fully client-controlled, so relying on it alone would
    // let an attacker rotate the header to defeat both the rate limit and the
    // auth-fail lockout below. Fall back to the first XFF hop, then the socket.
    const clientIp = req.headers['cf-connecting-ip']
      || req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(clientIp)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Rate limited. Try again in a minute.' }));
      return;
    }
    // CORS headers — allow runonaspen.com, www.runonaspen.com, any subdomain (tunnel URLs), and local dev
    const origin = req.headers.origin || '';
    const corsAllowed = origin === 'https://runonaspen.com'
      || origin === 'https://www.runonaspen.com'
      || (origin.startsWith('https://') && origin.endsWith('.runonaspen.com'))
      || origin.startsWith('http://localhost')
      || origin === 'capacitor://localhost'
      || origin === 'ionic://localhost';
    const corsOrigin = corsAllowed ? origin : 'https://runonaspen.com';
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
- Be helpful, direct, and concise. Skip preambles and disclaimers.\n\n${ASPEN_ABOUT}`;
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
            // CLAMP num_ctx for EVERY client, unconditionally. A client that sends
            // its own num_ctx (the iOS build was sending 262144 = 256K) makes Ollama
            // hold the model at that context; the next request at a different ctx
            // forces a full reload of the 30GB model — slow + constant cold loads,
            // and the giant KV cache makes that client glacial. One shared ctx =
            // one resident instance for web/iOS/desktop, no reloads.
            parsed.options.num_ctx = ctx;
            // Pin the model resident for EVERY client. A finite client keep_alive
            // (iOS was sending one) idle-evicts the model every few minutes.
            parsed.keep_alive = -1;
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

      // ── /v1/world-model — per-key memory sync ──
      // Returns the CALLER's own memory. Owner sees the owner memory; named
      // keys (Ashini/Anjali/Anoushka) see their own; anonymous keys get empty.
      if (req.url === '/v1/world-model' && req.method === 'GET') {
        const worldModel = require('./world-model');
        const memKeyId = apikeys.memoryKeyFor(authToken);
        if (memKeyId === null) {
          // Anonymous / no-memory key — nothing to show
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ facts: [], hasMemory: false }));
          return;
        }
        const facts = worldModel.getFacts(memKeyId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ facts, hasMemory: true, owner: apikeys.isOwnerKey(authToken) }));
        return;
      }

      // ── /v1/agent — full agent loop with tool execution ──
      // Runs on THIS machine: web/mobile clients get web_search, calculate,
      // computer use, run_command, etc. Owner key gates the dangerous tools.
      if (req.url === '/v1/agent' && req.method === 'POST') {
        let parsed;
        try { parsed = JSON.parse(body); } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
          return;
        }

        const agentModel = parsed.model || store.get('activeModel') || 'llama3';
        const agentMsgs = parsed.messages;
        if (!Array.isArray(agentMsgs) || agentMsgs.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'messages array required' }));
          return;
        }

        const isOwner = apikeys.isOwnerKey(authToken);
        const memoryKeyId = apikeys.memoryKeyFor(authToken);
        const wantStream = parsed.stream !== false;

        if (!wantStream) {
          // Non-streaming: collect full response in async IIFE
          (async () => {
            let fullText = '';
            try {
              for await (const event of gatewayAgent.runValidated({ model: agentModel, messages: agentMsgs, isOwner, memoryKeyId })) {
                if (event.type === 'content') fullText += event.text;
                if (event.type === 'error') throw new Error(event.text);
              }
            } catch (e) {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: { message: e.message, type: 'agent_error' } }));
              return;
            }
            const payload = {
              id: 'chatcmpl-aspen-agent', object: 'chat.completion',
              created: Math.floor(Date.now() / 1000), model: agentModel,
              choices: [{ index: 0, message: { role: 'assistant', content: fullText }, finish_reason: 'stop' }],
            };
            const buf = Buffer.from(JSON.stringify(payload));
            res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': String(buf.length) });
            res.end(buf);
          })();
          return;
        }

        // Streaming: SSE with heartbeat so long tool chains don't time out
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        });

        const base = {
          id: 'chatcmpl-aspen-agent', object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000), model: agentModel,
        };
        const send = (delta, extra = {}) => {
          if (res.writableEnded) return;
          try {
            res.write(`data: ${JSON.stringify({
              ...base,
              choices: [{ index: 0, delta, finish_reason: null }],
              ...extra,
            })}\n\n`);
          } catch {}
        };
        const done = () => {
          if (res.writableEnded) return;
          try {
            res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
          } catch {}
        };

        // Open stream immediately so the client sees a response
        send({ role: 'assistant' });

        // Heartbeat — prevents Vercel/nginx from closing a slow tool execution
        const heartbeat = setInterval(() => {
          if (res.writableEnded) { clearInterval(heartbeat); return; }
          try { res.write(': keep-alive\n\n'); } catch { clearInterval(heartbeat); }
        }, 8000);

        (async () => {
          try {
            for await (const event of gatewayAgent.runValidated({ model: agentModel, messages: agentMsgs, isOwner, memoryKeyId })) {
              if (res.writableEnded) break;
              switch (event.type) {
                case 'model':
                  base.model = event.name;
                  send({}, { aspen_model: event.name });
                  break;
                case 'status':
                  send({}, { aspen_status: event.text, ...(event.transient ? { aspen_transient: true } : {}) });
                  break;
                case 'tool_call':
                  send({}, { aspen_status: event.statusText, aspen_tool: event.name });
                  break;
                case 'tool_result':
                  // Brief pause after tool result before the model continues
                  await new Promise(r => setTimeout(r, 50));
                  break;
                case 'content': {
                  // Content events are already token/delta-sized from the
                  // streaming fast path — pass straight through with no delay.
                  // (The agent path emits one big block; still fine to send whole.)
                  if (!res.writableEnded) send({ content: event.text });
                  break;
                }
                case 'error':
                  send({ content: `\n\nError: ${event.text}` });
                  break;
                case 'done':
                  break;
              }
            }
          } catch (e) {
            if (!res.writableEnded) send({ content: `\n\nError: ${e.message}` });
          } finally {
            clearInterval(heartbeat);
            done();
          }
        })();

        return; // don't fall through to Ollama proxy
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
    // Warm the active model so the first user message doesn't pay a cold-load
    // penalty. Fire-and-forget; failure is harmless. First, let the model manager
    // reconcile: evict any leftover models from memory and retire superseded ones
    // so the box isn't thrashing on a stale 65GB model.
    setTimeout(async () => {
      try {
        const store = require('./store');
        let activeModel = store.get('activeModel');
        if (!activeModel) return;
        try {
          const manager = require('./model-manager');
          const reg = await require('./registry').getRegistry();
          const installed = await manager.installedModels();
          // If the active model is deprecated (e.g. scout), migrate to the best
          // installed model automatically so the user never has to switch by hand.
          const best = manager.pickActiveModel({ current: activeModel, installed, reg });
          if (best && best !== activeModel) {
            store.set('activeModel', best);
            console.log(`[Aspen] Active model migrated off deprecated '${activeModel}' -> '${best}'`);
            activeModel = best;
          }
          const r = await manager.manage(activeModel, {
            autoRetire: store.get('autoRetireModels') !== false,
            lean: store.get('leanMode') !== false,   // default on: keep only best + coder
          });
          if (r.evicted.length) console.log(`[Aspen] Evicted from memory: ${r.evicted.join(', ')}`);
          if (r.retired.length) console.log(`[Aspen] Retired superseded models: ${r.retired.join(', ')} (freed ~${r.freedGB.toFixed(0)}GB)`);
        } catch (e) { console.log('[Aspen] model manager skipped:', e.message); }
        const warmBody = JSON.stringify({ model: activeModel, messages: [{ role: 'user', content: 'hi' }], stream: false, keep_alive: -1, options: { num_predict: 1, num_ctx: system.getRecommendedContext() } });
        const warmReq = http.request({
          hostname: '127.0.0.1', port: 11434, path: '/api/chat', method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(warmBody) },
        }, (r) => { r.on('data', () => {}); r.on('end', () => console.log(`[Aspen] Warmed model: ${activeModel}`)); });
        warmReq.on('error', () => {});
        warmReq.write(warmBody);
        warmReq.end();
      } catch {}
    }, 2000);

    // ── Keep the active model hot ────────────────────────────────────────────
    // keep_alive:-1 should keep the model resident, but memory pressure from
    // other apps, an Ollama restart, or a 3rd model briefly loading (vision /
    // coder / extraction) can still evict it. A cheap preload every 45s repairs
    // any eviction in the BACKGROUND, so the user's next message never pays the
    // cold-load. This is the fix for the recurring "Loading <model> into
    // memory…" message. /api/generate with no prompt loads+pins without
    // generating; num_ctx matches every other path so it never triggers a reload.
    if (!global.__aspenKeepWarm) {
      global.__aspenKeepWarm = setInterval(() => {
        try {
          const model = require('./store').get('activeModel');
          if (!model) return;
          const b = JSON.stringify({ model, keep_alive: -1, options: { num_ctx: system.getRecommendedContext() } });
          const rq = http.request({ hostname: '127.0.0.1', port: 11434, path: '/api/generate', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
            (r) => { r.on('data', () => {}); r.on('end', () => {}); });
          rq.on('error', () => {});
          rq.write(b); rq.end();
        } catch {}
      }, 45000);
    }
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
  const model = parsed.model || store.get('activeModel') || 'llama3';
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

      const content = await agent.runAgentValidated({ model, messages: parsed.messages, isOwner: apikeys.isOwnerKey(authToken) });

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
      const content = await agent.runAgentValidated({ model, messages: parsed.messages, isOwner: apikeys.isOwnerKey(authToken) });
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
