/**
 * Community Savings API
 *
 * POST /api/community-savings  — submit your savings (anonymous, exchange count + $ saved)
 * GET  /api/community-savings  — get recent entries + running total
 *
 * Stored in Vercel KV. Each entry: { saved, exchanges, ts }
 * Rate-limited by IP: 1 submission per 24h.
 */

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function kv(method, key, value) {
  if (!KV_URL || !KV_TOK) throw new Error('KV not configured');
  const headers = { Authorization: `Bearer ${KV_TOK}`, 'Content-Type': 'application/json' };
  if (method === 'GET') {
    const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, { headers });
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    return j.result ?? null;
  }
  if (method === 'SET') {
    const r = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers,
      body: typeof value === 'string' ? value : JSON.stringify(value),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error);
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // ── GET: return community feed + total ──
  if (req.method === 'GET') {
    try {
      const raw = await kv('GET', 'community:savings:entries');
      let entries = [];
      if (raw) {
        try { entries = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch {}
      }
      if (!Array.isArray(entries)) entries = [];
      const total = entries.reduce((s, e) => s + (e.saved || 0), 0);
      const totalExchanges = entries.reduce((s, e) => s + (e.exchanges || 0), 0);
      return res.status(200).json({
        total: parseFloat(total.toFixed(2)),
        totalExchanges,
        count: entries.length,
        recent: entries.slice(-20).reverse(), // last 20, newest first
      });
    } catch (err) {
      return res.status(200).json({ total: 0, totalExchanges: 0, count: 0, recent: [] });
    }
  }

  // ── POST: submit savings ──
  if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });

  const { exchanges, saved } = req.body || {};
  if (!exchanges || !saved || typeof exchanges !== 'number' || typeof saved !== 'number') {
    return res.status(400).json({ error: 'exchanges and saved required (numbers)' });
  }
  if (exchanges < 1 || saved < 0 || saved > 100000) {
    return res.status(400).json({ error: 'invalid values' });
  }

  // Rate limit: 1 share per IP per 24h
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const ipKey = `community:ratelimit:${ip}`;
  try {
    const lastShare = await kv('GET', ipKey);
    if (lastShare && Date.now() - parseInt(lastShare) < 86400000) {
      return res.status(429).json({ error: 'Already shared today' });
    }
  } catch {}

  try {
    const raw = await kv('GET', 'community:savings:entries');
    let entries = [];
    if (raw) {
      try { entries = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch {}
    }
    if (!Array.isArray(entries)) entries = [];
    entries.push({ saved: parseFloat(saved.toFixed(2)), exchanges: Math.floor(exchanges), ts: Date.now() });
    if (entries.length > 500) entries.splice(0, entries.length - 500);
    await kv('SET', 'community:savings:entries', JSON.stringify(entries));
    await kv('SET', ipKey, String(Date.now()));
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[community-savings] KV error:', err.message);
    return res.status(500).json({ error: 'Failed to save', detail: err.message });
  }
}
