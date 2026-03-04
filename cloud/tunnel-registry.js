/**
 * Tunnel Registry
 *
 * Maps stable tunnel IDs to current Cloudflare Quick Tunnel URLs.
 * When a user's LLM Bear app starts, it heartbeats with its new URL.
 * Requests to /t/:tunnelId/* get proxied to that URL.
 *
 * Storage: SQLite (same DB as cloud backend)
 */

const crypto = require('crypto');
const db = require('./db');

// ═══════════════════════════════════════════════════
// Schema — added to existing DB
// ═══════════════════════════════════════════════════

function initSchema() {
  const conn = db.getDb();
  conn.exec(`
    CREATE TABLE IF NOT EXISTS tunnels (
      tunnel_id    TEXT PRIMARY KEY,
      tunnel_secret_hash TEXT NOT NULL,
      cloudflare_url TEXT,
      last_heartbeat TEXT,
      created_at   TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tunnels_heartbeat ON tunnels(last_heartbeat);
  `);
}

// ═══════════════════════════════════════════════════
// Registration — first time setup
// ═══════════════════════════════════════════════════

function register() {
  const conn = db.getDb();
  const tunnelId = generateTunnelId();
  const tunnelSecret = 'ts-' + crypto.randomBytes(16).toString('base64url');
  const secretHash = hashSecret(tunnelSecret);

  conn.prepare(`
    INSERT INTO tunnels (tunnel_id, tunnel_secret_hash) VALUES (?, ?)
  `).run(tunnelId, secretHash);

  return { tunnelId, tunnelSecret };
}

// ═══════════════════════════════════════════════════
// Heartbeat — app sends new Cloudflare URL on startup
// ═══════════════════════════════════════════════════

function heartbeat(tunnelId, tunnelSecret, cloudflareUrl) {
  const conn = db.getDb();
  const tunnel = conn.prepare('SELECT tunnel_secret_hash FROM tunnels WHERE tunnel_id = ?').get(tunnelId);

  if (!tunnel) return { error: 'not_found' };

  if (!verifySecret(tunnelSecret, tunnel.tunnel_secret_hash)) {
    return { error: 'invalid_secret' };
  }

  // Validate URL format
  if (!cloudflareUrl || !cloudflareUrl.startsWith('https://')) {
    return { error: 'invalid_url' };
  }

  conn.prepare(`
    UPDATE tunnels SET cloudflare_url = ?, last_heartbeat = datetime('now') WHERE tunnel_id = ?
  `).run(cloudflareUrl, tunnelId);

  return { ok: true, url: `${process.env.API_BASE_URL || 'https://api.llmbear.com'}/t/${tunnelId}` };
}

// ═══════════════════════════════════════════════════
// Resolve — get current Cloudflare URL for a tunnel ID
// ═══════════════════════════════════════════════════

function resolve(tunnelId) {
  const conn = db.getDb();
  const tunnel = conn.prepare('SELECT cloudflare_url, last_heartbeat FROM tunnels WHERE tunnel_id = ?').get(tunnelId);

  if (!tunnel || !tunnel.cloudflare_url) return null;

  return {
    cloudflareUrl: tunnel.cloudflare_url,
    lastHeartbeat: tunnel.last_heartbeat,
  };
}

// ═══════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════

function generateTunnelId() {
  // Short, URL-safe, memorable: 6 chars = 2 billion combinations
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(6);
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars[bytes[i] % chars.length];
  }
  return id;
}

function hashSecret(secret) {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

function verifySecret(secret, hash) {
  return hashSecret(secret) === hash;
}

// ═══════════════════════════════════════════════════
// Cleanup stale tunnels (no heartbeat in 30 days)
// ═══════════════════════════════════════════════════

function cleanup() {
  const conn = db.getDb();
  const result = conn.prepare(`
    DELETE FROM tunnels WHERE last_heartbeat < datetime('now', '-30 days')
  `).run();
  return result.changes;
}

module.exports = {
  initSchema,
  register,
  heartbeat,
  resolve,
  cleanup,
  generateTunnelId,
};
