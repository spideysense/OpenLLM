/**
 * Community Savings API
 *
 * POST /api/community-savings  — upsert your savings (anonymous, by IP)
 * GET  /api/community-savings  — get totals + recent entries
 *
 * Data model:
 *   community:totals          → { totalSaved, totalExchanges, count }
 *   community:entry:{ip}      → { saved, exchanges, ts }
 *   community:recent          → JSON array of last 20 entries (for feed)
 *
 * Each IP has ONE entry that gets updated. No rate limiting — users should
 * always be able to share their current savings. We just update, not append.
 */

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function kvGet(key) {
  if (!KV_URL || !KV_TOK) throw new Error('KV not configured');
  const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOK}` },
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result ?? null;
}

async function kvSet(key, value) {
  if (!KV_URL || !KV_TOK) throw new Error('KV not configured');
  const r = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
}

function parseJSON(raw, fallback) {
  if (!raw) return fallback;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return fallback; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // ── GET ──
  if (req.method === 'GET') {
    try {
      const raw = await kvGet('community:totals');
      const totals = parseJSON(raw, { totalSaved: 0, totalExchanges: 0, count: 0 });
      const recentRaw = await kvGet('community:recent');
      const recent = parseJSON(recentRaw, []);
      return res.status(200).json({
        total: parseFloat((totals.totalSaved || 0).toFixed(2)),
        totalExchanges: totals.totalExchanges || 0,
        count: totals.count || 0,
        recent: Array.isArray(recent) ? recent : [],
      });
    } catch (err) {
      console.error('[community-savings] GET error:', err.message);
      return res.status(200).json({ total: 0, totalExchanges: 0, count: 0, recent: [] });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });

  // ── POST ──
  const { exchanges, saved } = req.body || {};
  if (!exchanges || saved == null || typeof exchanges !== 'number' || typeof saved !== 'number') {
    return res.status(400).json({ error: 'exchanges and saved required (numbers)' });
  }
  if (exchanges < 1 || saved < 0 || saved > 1000000) {
    return res.status(400).json({ error: 'invalid values' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'anonymous';
  const entryKey = `community:entry:${ip}`;

  try {
    // Get current totals and this user's existing entry
    const [totalsRaw, oldEntryRaw, recentRaw] = await Promise.all([
      kvGet('community:totals'),
      kvGet(entryKey),
      kvGet('community:recent'),
    ]);

    const totals = parseJSON(totalsRaw, { totalSaved: 0, totalExchanges: 0, count: 0 });
    const oldEntry = parseJSON(oldEntryRaw, null);
    const recent = parseJSON(recentRaw, []);

    const newSaved = parseFloat(saved.toFixed(2));
    const newExchanges = Math.floor(exchanges);

    // Adjust totals: remove old entry's contribution, add new
    if (oldEntry) {
      totals.totalSaved -= (oldEntry.saved || 0);
      totals.totalExchanges -= (oldEntry.exchanges || 0);
    } else {
      totals.count = (totals.count || 0) + 1;
    }
    totals.totalSaved = Math.max(0, (totals.totalSaved || 0) + newSaved);
    totals.totalExchanges = Math.max(0, (totals.totalExchanges || 0) + newExchanges);

    const newEntry = { saved: newSaved, exchanges: newExchanges, ts: Date.now() };

    // Update recent feed: remove old entry from this IP if exists, prepend new
    const filtered = Array.isArray(recent) ? recent.filter((e) => e.ip !== ip) : [];
    const updatedRecent = [{ ...newEntry, ip }].concat(filtered).slice(0, 20);

    // Save everything
    await Promise.all([
      kvSet('community:totals', JSON.stringify(totals)),
      kvSet(entryKey, JSON.stringify(newEntry)),
      kvSet('community:recent', JSON.stringify(updatedRecent)),
    ]);

    return res.status(200).json({ ok: true, total: parseFloat(totals.totalSaved.toFixed(2)) });
  } catch (err) {
    console.error('[community-savings] POST error:', err.message);
    return res.status(500).json({ error: 'Failed to save', detail: err.message });
  }
}
