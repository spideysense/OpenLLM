const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { v4: uuid } = require('uuid');

const DB_PATH = process.env.DB_PATH || (
  process.env.VERCEL ? '/tmp/monet.db' : path.join(__dirname, 'data', 'monet.db')
);

let db;

function getDb() {
  if (!db) init();
  return db;
}

function init() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      plan TEXT NOT NULL DEFAULT 'free',
      stripe_customer_id TEXT UNIQUE,
      stripe_subscription_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      secret_hash TEXT NOT NULL,
      secret_prefix TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT 'Default',
      last_used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tokens_in INTEGER NOT NULL DEFAULT 0,
      tokens_out INTEGER NOT NULL DEFAULT 0,
      model TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_usage_user_date ON usage(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(secret_hash);
  `);

  return db;
}

// ── Plans ──

const PLANS = {
  free:    { name: 'Cave Bear',    price: 0,    rpm: 0,    dailyTokens: 0,         cloud: false },
  cloud:   { name: 'Cloud Bear',   price: 0.99, rpm: 30,   dailyTokens: 500_000,   cloud: true },
  grizzly: { name: 'Grizzly Bear', price: 1.99, rpm: 60,   dailyTokens: 2_000_000, cloud: true },
};

function getPlan(planId) {
  return PLANS[planId] || PLANS.free;
}

// ── Users ──

function createUser({ email, name, plan = 'free', stripeCustomerId = null }) {
  const id = uuid();
  getDb().prepare(`
    INSERT INTO users (id, email, name, plan, stripe_customer_id) VALUES (?, ?, ?, ?, ?)
  `).run(id, email, name, plan, stripeCustomerId);
  return getUserById(id);
}

function getUserById(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function getUserByEmail(email) {
  return getDb().prepare('SELECT * FROM users WHERE email = ?').get(email);
}

function getUserByStripeCustomer(stripeCustomerId) {
  return getDb().prepare('SELECT * FROM users WHERE stripe_customer_id = ?').get(stripeCustomerId);
}

function updateUserPlan(userId, plan, stripeSubscriptionId = null) {
  getDb().prepare(`
    UPDATE users SET plan = ?, stripe_subscription_id = ?, updated_at = datetime('now') WHERE id = ?
  `).run(plan, stripeSubscriptionId, userId);
  return getUserById(userId);
}

function updateStripeCustomer(userId, stripeCustomerId) {
  getDb().prepare(`
    UPDATE users SET stripe_customer_id = ?, updated_at = datetime('now') WHERE id = ?
  `).run(stripeCustomerId, userId);
}

// ── API Keys ──

function createApiKey(userId, label = 'Default') {
  const id = uuid();
  const raw = 'sk-monet-' + crypto.randomBytes(24).toString('base64url');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const prefix = raw.slice(0, 12) + '...';

  getDb().prepare(`
    INSERT INTO api_keys (id, user_id, secret_hash, secret_prefix, label) VALUES (?, ?, ?, ?, ?)
  `).run(id, userId, hash, prefix, label);

  // Return the raw key only on creation — it's never stored
  return { id, secret: raw, prefix, label };
}

function validateApiKey(raw) {
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const row = getDb().prepare(`
    SELECT ak.*, u.id as uid, u.email, u.plan
    FROM api_keys ak JOIN users u ON ak.user_id = u.id
    WHERE ak.secret_hash = ?
  `).get(hash);

  if (row) {
    getDb().prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(row.id);
  }
  return row || null;
}

function listApiKeys(userId) {
  return getDb().prepare('SELECT id, secret_prefix, label, last_used_at, created_at FROM api_keys WHERE user_id = ?').all(userId);
}

function revokeApiKey(keyId, userId) {
  return getDb().prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?').run(keyId, userId);
}

// ── Usage ──

function recordUsage(userId, model, tokensIn, tokensOut) {
  getDb().prepare(`
    INSERT INTO usage (user_id, model, tokens_in, tokens_out) VALUES (?, ?, ?, ?)
  `).run(userId, model, tokensIn, tokensOut);
}

function getDailyUsage(userId) {
  const row = getDb().prepare(`
    SELECT COALESCE(SUM(tokens_in + tokens_out), 0) as total_tokens
    FROM usage WHERE user_id = ? AND created_at >= date('now')
  `).get(userId);
  return row?.total_tokens || 0;
}

function getUsageSummary(userId, days = 30) {
  return getDb().prepare(`
    SELECT date(created_at) as day, SUM(tokens_in) as tokens_in, SUM(tokens_out) as tokens_out, COUNT(*) as requests
    FROM usage WHERE user_id = ? AND created_at >= date('now', ?)
    GROUP BY date(created_at) ORDER BY day DESC
  `).all(userId, `-${days} days`);
}

module.exports = {
  init, getDb, PLANS, getPlan,
  createUser, getUserById, getUserByEmail, getUserByStripeCustomer,
  updateUserPlan, updateStripeCustomer,
  createApiKey, validateApiKey, listApiKeys, revokeApiKey,
  recordUsage, getDailyUsage, getUsageSummary,
};
