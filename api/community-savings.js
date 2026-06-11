/**
 * Community Savings API — simple, no restrictions.
 * POST: append your savings to the feed and running total.
 * GET:  return total + recent feed.
 * No rate limiting. No IP tracking. Share as often as you want.
 */

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function kvGet(key) {
  const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOK}` },
  });
  const j = await r.json();
  return j.result ?? null;
}

async function kvSet(key, value) {
  const r = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
}

function parse(raw, fallback) {
  if (!raw) return fallback;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return fallback; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    try {
      const [totalsRaw, recentRaw] = await Promise.all([
        kvGet('savings:totals'),
        kvGet('savings:recent'),
      ]);
      const totals = parse(totalsRaw, { total: 0, exchanges: 0, shares: 0 });
      const recent = parse(recentRaw, []);
      return res.status(200).json({
        total: parseFloat((totals.total || 0).toFixed(2)),
        totalExchanges: totals.exchanges || 0,
        count: totals.shares || 0,
        recent: Array.isArray(recent) ? recent : [],
      });
    } catch (err) {
      return res.status(200).json({ total: 0, totalExchanges: 0, count: 0, recent: [] });
    }
  }

  if (req.method !== 'POST') return res.status(405).end();

  const { exchanges, saved } = req.body || {};
  if (typeof exchanges !== 'number' || typeof saved !== 'number') {
    return res.status(400).json({ error: 'exchanges and saved must be numbers' });
  }

  try {
    const [totalsRaw, recentRaw] = await Promise.all([
      kvGet('savings:totals'),
      kvGet('savings:recent'),
    ]);
    const totals = parse(totalsRaw, { total: 0, exchanges: 0, shares: 0 });
    const recent = parse(recentRaw, []);

    totals.total = parseFloat(((totals.total || 0) + saved).toFixed(2));
    totals.exchanges = (totals.exchanges || 0) + Math.floor(exchanges);
    totals.shares = (totals.shares || 0) + 1;

    const entry = { saved: parseFloat(saved.toFixed(2)), exchanges: Math.floor(exchanges), ts: Date.now() };
    const updatedRecent = [entry, ...(Array.isArray(recent) ? recent : [])].slice(0, 50);

    await Promise.all([
      kvSet('savings:totals', JSON.stringify(totals)),
      kvSet('savings:recent', JSON.stringify(updatedRecent)),
    ]);

    return res.status(200).json({ ok: true, total: totals.total });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
