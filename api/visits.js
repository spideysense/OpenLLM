/**
 * Visitor counter
 * Uses Vercel KV if KV_REST_API_URL + KV_REST_API_TOKEN are set (free tier: 30k ops/month).
 * Falls back to an in-memory counter seeded at VISIT_SEED env var (default 847).
 * To set up Vercel KV: vercel.com/dashboard → Storage → Create KV → link to project.
 */

// In-memory fallback — persists per function instance, resets on cold start
let memCount = parseInt(process.env.VISIT_SEED || '847', 10);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Try Vercel KV first (truly persistent)
  const kvUrl   = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  if (kvUrl && kvToken) {
    try {
      // INCR is atomic — safe for concurrent requests
      const r = await fetch(`${kvUrl}/incr/monet:visits`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${kvToken}` },
      });
      if (r.ok) {
        const data = await r.json();
        const count = (data.result || 0) + parseInt(process.env.VISIT_SEED || '847', 10);
        return res.status(200).json({ count });
      }
    } catch {}
  }

  // Fallback: in-memory counter
  memCount++;
  return res.status(200).json({ count: memCount });
}
