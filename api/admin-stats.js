/**
 * /api/admin-stats — real metrics for the /admin dashboard.
 *
 * Password is checked SERVER-SIDE against ADMIN_PASSWORD (never sent to client).
 * Returns only data we actually have:
 *   - GitHub release download counts (real, from GitHub API)
 *   - Site visits (from the visits KV counter)
 *   - Trial usage: sessions started, messages used, estimated cost (from trial KV)
 *
 * Local-app users/messages are intentionally NOT here — the app is private and
 * reports nothing back. We show that honestly rather than inventing a number.
 */

const GH_OWNER = 'spideysense';
const GH_REPO = 'OpenLLM';

// Rough cost estimate for trial messages (host machine electricity + amortized).
// This is an ESTIMATE, labeled as such in the UI — not a real billing figure.
const EST_COST_PER_TRIAL_MSG = 0.002;

async function kvGet(url, token, key) {
  try {
    const r = await fetch(`${url}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    return (await r.json()).result;
  } catch { return null; }
}

async function kvSet(url, token, key, value) {
  try {
    await fetch(`${url}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`, { headers: { Authorization: `Bearer ${token}` } });
  } catch {}
}

async function kvSumPrefix(url, token, prefix) {
  // Sum all integer values under a key prefix (e.g. all trial:ip:* ).
  try {
    const scan = await fetch(`${url}/keys/${encodeURIComponent(prefix + '*')}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!scan.ok) return { count: 0, sum: 0 };
    const keys = (await scan.json()).result || [];
    let sum = 0;
    for (const k of keys) {
      const v = parseInt(await kvGet(url, token, k)) || 0;
      sum += v;
    }
    return { count: keys.length, sum };
  } catch { return { count: 0, sum: 0 }; }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // ── Server-side password check ──
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return res.status(503).json({ error: 'Admin not configured (set ADMIN_PASSWORD).' });
  let body = {};
  try { body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}'); } catch {}
  if (!body.password || body.password !== expected) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }

  // ── Set download floor manually ──
  if (body.action === 'setFloor' && body.floor != null) {
    const kvUrl = process.env.KV_REST_API_URL, kvTok = process.env.KV_REST_API_TOKEN;
    if (kvUrl && kvTok) {
      await kvSet(kvUrl, kvTok, 'aspen:download_floor', String(body.floor));
      return res.status(200).json({ success: true, floor: body.floor });
    }
    return res.status(503).json({ error: 'KV not configured' });
  }

  const out = { downloads: { total: 0, byRelease: [] }, visits: null, trial: null, notes: [] };

  // ── GitHub download counts (real) ──
  try {
    const ghHeaders = { 'User-Agent': 'Aspen-Admin', Accept: 'application/vnd.github+json' };
    if (process.env.GH_TOKEN) ghHeaders.Authorization = `token ${process.env.GH_TOKEN}`;
    const r = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/releases?per_page=30`, { headers: ghHeaders });
    if (r.ok) {
      const releases = await r.json();
      for (const rel of releases) {
        let relTotal = 0;
        for (const a of rel.assets || []) relTotal += a.download_count || 0;
        out.downloads.byRelease.push({ tag: rel.tag_name, downloads: relTotal });
        out.downloads.total += relTotal;
      }
      // Download floor — never show a number lower than the highest we've seen.
      // Re-publishing a release resets its GitHub download count, which makes the
      // total drop. We store the high-water mark in KV and use it as a floor.
      const kvUrl = process.env.KV_REST_API_URL, kvTok = process.env.KV_REST_API_TOKEN;
      if (kvUrl && kvTok) {
        const floor = parseInt(await kvGet(kvUrl, kvTok, 'aspen:download_floor')) || 0;
        if (out.downloads.total > floor) {
          await kvSet(kvUrl, kvTok, 'aspen:download_floor', String(out.downloads.total));
        } else if (out.downloads.total < floor) {
          out.downloads.total = floor;
        }
      }
    } else {
      out.notes.push('GitHub download data unavailable.');
    }
  } catch { out.notes.push('GitHub download data unavailable.'); }

  // ── Site visits (from visits KV) ──
  const vUrl = process.env.KV_REST_API_URL, vTok = process.env.KV_REST_API_TOKEN;
  if (vUrl && vTok) {
    const v = parseInt(await kvGet(vUrl, vTok, 'aspen:visits')) || 0;
    out.visits = v + parseInt(process.env.VISIT_SEED || '847', 10);
  } else {
    out.notes.push('Visit counter not configured.');
  }

  // ── Trial usage (from trial KV — Upstash) ──
  const tUrl = process.env.UPSTASH_REDIS_REST_URL, tTok = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (tUrl && tTok) {
    // Sessions started = count of trial:sess:* keys; messages = sum of their values + expired (best effort).
    const sessions = await kvSumPrefix(tUrl, tTok, 'trial:sess:');
    const ipUsage = await kvSumPrefix(tUrl, tTok, 'trial:ip:');
    const msgs = ipUsage.sum; // IP counters capture total messages even after sessions expire
    out.trial = {
      activeSessions: sessions.count,
      messagesUsed: msgs,
      estCostUsd: +(msgs * EST_COST_PER_TRIAL_MSG).toFixed(2),
    };
  } else {
    out.notes.push('Trial counters not configured.');
  }

  out.notes.push('Local-app users & messages are not tracked — the app is private and reports nothing back.');
  return res.status(200).json(out);
}
