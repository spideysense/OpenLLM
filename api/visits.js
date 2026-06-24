/**
 * Visitor counter
 * Uses Vercel KV if KV_REST_API_URL + KV_REST_API_TOKEN are set (free tier: 30k ops/month).
 * Falls back to an in-memory counter seeded at VISIT_SEED env var (default 847).
 * To set up Vercel KV: vercel.com/dashboard → Storage → Create KV → link to project.
 */

// In-memory fallback — persists per function instance, resets on cold start
let memCount = parseInt(process.env.VISIT_SEED || '2000', 10);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Source attribution (first-touch, sent by the client).
  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch {}
  const source = (body.source || 'direct').toString().slice(0, 60);
  const action = (body.action || '').toString();
  const platform = (body.platform || '').toString().slice(0, 12);

  // Try Vercel KV first (truly persistent)
  const kvUrl   = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  // A download-button click — attribute it to its source, don't count as a visit.
  if (action === 'download') {
    if (kvUrl && kvToken) {
      const field = `${source}|${platform || 'other'}`;
      fetch(`${kvUrl}/hincrby/aspen:dlsrc/${encodeURIComponent(field)}/1`, {
        method: 'POST', headers: { Authorization: `Bearer ${kvToken}` },
      }).catch(() => {});
    }
    return res.status(200).json({ ok: true });
  }

  if (kvUrl && kvToken) {
    try {
      // Record which source sent this visit (utm / referrer / direct).
      fetch(`${kvUrl}/hincrby/aspen:src/${encodeURIComponent(source)}/1`, {
        method: 'POST', headers: { Authorization: `Bearer ${kvToken}` },
      }).catch(() => {});
      // Record visitor location (city-level) for the map. Vercel tags every
      // request with geo headers. Fire-and-forget so it never slows the visit.
      const country = req.headers['x-vercel-ip-country'] || '';
      const lat = req.headers['x-vercel-ip-latitude'] || '';
      const lon = req.headers['x-vercel-ip-longitude'] || '';
      let city = '';
      try { city = decodeURIComponent(req.headers['x-vercel-ip-city'] || ''); } catch {}
      if (lat && lon) {
        const rlat = Math.round(parseFloat(lat) * 100) / 100;
        const rlon = Math.round(parseFloat(lon) * 100) / 100;
        const field = `${country}|${rlat}|${rlon}|${city}`;
        fetch(`${kvUrl}/hincrby/aspen:geo/${encodeURIComponent(field)}/1`, {
          method: 'POST', headers: { Authorization: `Bearer ${kvToken}` },
        }).catch(() => {});
      }

      // INCR is atomic — safe for concurrent requests
      const r = await fetch(`${kvUrl}/incr/aspen:visits`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${kvToken}` },
      });
      if (r.ok) {
        const data = await r.json();
        const count = (data.result || 0) + parseInt(process.env.VISIT_SEED || '2000', 10);
        return res.status(200).json({ count });
      }
    } catch {}
  }

  // Fallback: in-memory counter
  memCount++;
  return res.status(200).json({ count: memCount });
}
