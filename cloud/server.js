const express = require('express');
const cors = require('cors');
const db = require('./db');
const { authRequired } = require('./auth');
const { rateLimit } = require('./rate-limit');
const { chatCompletions, listModels } = require('./proxy');
const { createCheckout, handleWebhook, getAccount } = require('./stripe-handler');

const app = express();
const PORT = process.env.PORT || 4001;

// ── CORS ──
const allowedOrigins = [
  process.env.LANDING_URL || 'https://open-llm-ten.vercel.app',
  'https://open-llm-ten.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173',
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.some(o => origin.startsWith(o)) || origin.includes('.vercel.app')) {
      cb(null, true);
    } else {
      cb(null, false);
    }
  },
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── Stripe webhook needs raw body ──
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), handleWebhook);

// ── JSON body parser for everything else ──
app.use(express.json());

// ── Health check ──
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'llmbear-cloud', version: '0.1.0' });
});

// ═══════════════════════════════════════════════════
// Public Routes (no auth)
// ═══════════════════════════════════════════════════

// Stripe checkout — creates a payment session
app.post('/checkout', createCheckout);

// Account info after checkout (uses Stripe session ID)
app.get('/account', getAccount);

// ═══════════════════════════════════════════════════
// OpenAI-Compatible API (auth + rate limited)
// ═══════════════════════════════════════════════════

// Chat completions
app.post('/v1/chat/completions', authRequired, rateLimit, chatCompletions);

// List models
app.get('/v1/models', authRequired, listModels);

// ═══════════════════════════════════════════════════
// Account Management (auth required)
// ═══════════════════════════════════════════════════

// List my API keys
app.get('/v1/keys', authRequired, (req, res) => {
  const keys = db.listApiKeys(req.user.id);
  res.json({ keys });
});

// Create a new API key
app.post('/v1/keys', authRequired, (req, res) => {
  const label = req.body.label || 'API Key';
  const key = db.createApiKey(req.user.id, label);
  res.json({
    id: key.id,
    secret: key.secret,
    prefix: key.prefix,
    label: key.label,
    note: 'Save this key — it will not be shown again.',
  });
});

// Revoke an API key
app.delete('/v1/keys/:keyId', authRequired, (req, res) => {
  db.revokeApiKey(req.params.keyId, req.user.id);
  res.json({ deleted: true });
});

// Usage summary
app.get('/v1/usage', authRequired, (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const summary = db.getUsageSummary(req.user.id, days);
  const dailyUsage = db.getDailyUsage(req.user.id);
  const plan = db.getPlan(req.user.plan);
  res.json({
    plan: req.user.plan,
    plan_name: plan.name,
    today: { tokens_used: dailyUsage, tokens_limit: plan.dailyTokens },
    history: summary,
  });
});

// ═══════════════════════════════════════════════════
// Tunnel Proxy — stable URLs for local AI
// ═══════════════════════════════════════════════════

const tunnelRegistry = require('./tunnel-registry');
const http = require('http');
const https = require('https');

tunnelRegistry.initSchema();

app.post('/tunnel/register', (req, res) => {
  try {
    const { tunnelId, tunnelSecret } = tunnelRegistry.register();
    const stableUrl = `${process.env.API_BASE_URL || 'https://api.llmbear.com'}/t/${tunnelId}`;
    res.json({ tunnelId, tunnelSecret, url: stableUrl });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/tunnel/heartbeat', (req, res) => {
  const { tunnelId, tunnelSecret, cloudflareUrl } = req.body;
  if (!tunnelId || !tunnelSecret || !cloudflareUrl) {
    return res.status(400).json({ error: 'Missing tunnelId, tunnelSecret, or cloudflareUrl' });
  }
  const result = tunnelRegistry.heartbeat(tunnelId, tunnelSecret, cloudflareUrl);
  if (result.error) {
    const status = result.error === 'not_found' ? 404 : result.error === 'invalid_secret' ? 401 : 400;
    return res.status(status).json({ error: result.error });
  }
  res.json(result);
});

app.options('/t/:tunnelId/*', (req, res) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  }).status(204).end();
});

app.all('/t/:tunnelId/*', (req, res) => {
  const { tunnelId } = req.params;
  const tunnel = tunnelRegistry.resolve(tunnelId);

  if (!tunnel) {
    return res.status(502).json({
      error: { message: 'Tunnel not found or offline. Make sure LLM Bear is running.', type: 'tunnel_error' }
    });
  }

  const lastBeat = new Date(tunnel.lastHeartbeat);
  const staleMinutes = (Date.now() - lastBeat.getTime()) / 60000;
  if (staleMinutes > 5) {
    return res.status(502).json({
      error: { message: 'LLM Bear appears offline (no heartbeat in ' + Math.round(staleMinutes) + ' min).', type: 'tunnel_offline' }
    });
  }

  const targetPath = req.originalUrl.replace(`/t/${tunnelId}`, '') || '/';
  const targetUrl = tunnel.cloudflareUrl + targetPath;
  const proxyModule = targetUrl.startsWith('https') ? https : http;
  const parsed = new URL(targetUrl);

  const proxyHeaders = { ...req.headers };
  proxyHeaders.host = parsed.host;
  delete proxyHeaders['content-length'];

  const proxyReq = proxyModule.request({
    hostname: parsed.hostname,
    port: parsed.port,
    path: parsed.pathname + parsed.search,
    method: req.method,
    headers: proxyHeaders,
    timeout: 120000,
  }, (proxyRes) => {
    const resHeaders = { ...proxyRes.headers };
    resHeaders['access-control-allow-origin'] = '*';
    resHeaders['x-powered-by'] = 'LLM Bear';
    delete resHeaders['transfer-encoding'];
    res.writeHead(proxyRes.statusCode, resHeaders);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    res.status(502).json({
      error: { message: 'Could not reach local AI. Make sure LLM Bear is running.', type: 'proxy_error', detail: err.message }
    });
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    res.status(504).json({
      error: { message: 'Request timed out.', type: 'timeout_error' }
    });
  });

  if (req.body && typeof req.body === 'object') {
    proxyReq.write(JSON.stringify(req.body));
  }
  proxyReq.end();
});

// ═══════════════════════════════════════════════════
// 404 handler
// ═══════════════════════════════════════════════════

app.use((req, res) => {
  res.status(404).json({
    error: {
      message: `Route not found: ${req.method} ${req.path}`,
      type: 'not_found',
      docs: 'https://open-llm-ten.vercel.app/#api',
    }
  });
});

// ═══════════════════════════════════════════════════
// Start
// ═══════════════════════════════════════════════════

db.init();

// Vercel: export the handler. Standalone: listen on PORT.
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`🐻 LLM Bear Cloud running on port ${PORT}`);
    console.log(`   GPU backend: ${process.env.GPU_BACKEND_URL || 'http://127.0.0.1:11434/v1'}`);
    console.log(`   Landing:     ${process.env.LANDING_URL || 'https://open-llm-ten.vercel.app'}`);
    console.log(`\n   Endpoints:`);
    console.log(`   POST /checkout              — Stripe checkout`);
    console.log(`   POST /v1/chat/completions   — Chat (OpenAI-compatible)`);
    console.log(`   GET  /v1/models             — List models`);
    console.log(`   GET  /v1/keys               — List API keys`);
    console.log(`   POST /v1/keys               — Create API key`);
    console.log(`   GET  /v1/usage              — Usage summary`);
  });
}

module.exports = app;
