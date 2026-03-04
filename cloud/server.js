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
app.use(cors({
  origin: process.env.LANDING_URL || 'https://open-llm-ten.vercel.app',
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

module.exports = app;
