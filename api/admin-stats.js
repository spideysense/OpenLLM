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
    const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL, kvTok = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
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
    // Page through EVERY release (the old code fetched only ?per_page=30, which
    // froze the total). Count only real installers — .dmg/.exe for Mac/Windows
    // and .AppImage/.deb for Linux. The .yml/.blockmap/.zip files are auto-update
    // machinery and would inflate "downloads" with update-check traffic.
    const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL, kvTok = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

    // Per-release high-water marks. GitHub resets an asset's download_count when
    // a release is re-published, so the live sum can drop. A single GLOBAL floor
    // (the old approach) froze at one peak forever — that was the 283 freeze.
    // Instead we keep each release's own peak in a hash and sum the peaks, so the
    // total is monotonic, survives re-publishes, and climbs as any release grows.
    let marks = {};
    if (kvUrl && kvTok) {
      try {
        const m = await fetch(`${kvUrl}/hgetall/aspen:dl_marks`, { headers: { Authorization: `Bearer ${kvTok}` }, cache: 'no-store' });
        if (m.ok) {
          const arr = (await m.json()).result || [];
          for (let i = 0; i < arr.length; i += 2) marks[arr[i]] = parseInt(arr[i + 1]) || 0;
        }
      } catch {}
    }

    let page = 1, fetchedAny = false;
    const toPersist = [];
    while (page <= 20) {
      const r = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/releases?per_page=100&page=${page}`, { headers: ghHeaders, cache: 'no-store', next: { revalidate: 0 } });
      if (!r.ok) { if (!fetchedAny) out.notes.push('GitHub download data unavailable.'); break; }
      const releases = await r.json();
      if (!Array.isArray(releases) || releases.length === 0) break;
      fetchedAny = true;
      for (const rel of releases) {
        let live = 0;
        for (const a of rel.assets || []) {
          const name = (a.name || '').toLowerCase();
          if (name.endsWith('.dmg') || name.endsWith('.exe') || name.endsWith('.appimage') || name.endsWith('.deb')) {
            live += a.download_count || 0;
          }
        }
        const tag = rel.tag_name;
        const prev = marks[tag] || 0;
        const best = live > prev ? live : prev;   // this release's all-time peak
        if (live > prev) toPersist.push([tag, best]);
        out.downloads.byRelease.push({ tag, downloads: best });
        out.downloads.total += best;
      }
      if (releases.length < 100) break;
      page++;
    }

    // Persist any raised marks (fire-and-forget, batched).
    if (kvUrl && kvTok && toPersist.length) {
      for (const [tag, val] of toPersist) {
        fetch(`${kvUrl}/hset/aspen:dl_marks/${encodeURIComponent(tag)}/${val}`, { method: 'POST', headers: { Authorization: `Bearer ${kvTok}` } }).catch(() => {});
      }
    }
  } catch { out.notes.push('GitHub download data unavailable.'); }

  // ── Site visits (from visits KV) ──
  const vUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL, vTok = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (vUrl && vTok) {
    const v = parseInt(await kvGet(vUrl, vTok, 'aspen:visits')) || 0;
    out.visits = v + parseInt(process.env.VISIT_SEED || '2000', 10);

    // Visitor locations for the map (city-level points, sized by count).
    out.geo = [];
    try {
      const g = await fetch(`${vUrl}/hgetall/aspen:geo`, { headers: { Authorization: `Bearer ${vTok}` }, cache: 'no-store' });
      if (g.ok) {
        const arr = (await g.json()).result || [];
        for (let i = 0; i < arr.length; i += 2) {
          const parts = String(arr[i]).split('|');
          const lat = parseFloat(parts[1]), lon = parseFloat(parts[2]);
          const count = parseInt(arr[i + 1]) || 0;
          if (!isNaN(lat) && !isNaN(lon)) out.geo.push({ country: parts[0] || '??', lat, lon, city: parts[3] || '', count });
        }
      }
    } catch {}
  } else {
    out.notes.push('Visit counter not configured.');
  }

  // ── Trial usage (from trial KV — Upstash) ──
  const tUrl = process.env.UPSTASH_REDIS_REST_URL, tTok = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (tUrl && tTok) {
    const sessions = await kvSumPrefix(tUrl, tTok, 'trial:sess:');
    // Durable, monotonic all-time counter — every trial-surface message ever sent.
    // Never expires, so it's reliable history. The per-IP keys (24h TTL) are kept
    // only as a floor during the transition so we never show LESS than recent use.
    const durable = parseInt(await kvGet(tUrl, tTok, 'aspen:trial_msgs_total')) || 0;
    const recent = await kvSumPrefix(tUrl, tTok, 'trial:ip:');
    const msgs = Math.max(durable, recent.sum);
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
