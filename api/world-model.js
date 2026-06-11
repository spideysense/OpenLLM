/**
 * /api/world-model — proxies to the gateway's /v1/world-model on the user's machine.
 *
 * Owner keys get the full World Model (memory). Guest keys get { owner: false }
 * and an empty facts array. The gateway enforces this — we just pass through.
 */
const ALLOWED = ['https://runonaspen.com', 'https://www.runonaspen.com', 'capacitor://localhost', 'ionic://localhost'];

function cors(origin) {
  const allow = (ALLOWED.includes(origin) || (origin && origin.endsWith('.runonaspen.com'))) ? origin : 'https://runonaspen.com';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const headers = cors(origin);
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { tunnelUrl, apiKey } = req.body || {};
  if (!tunnelUrl) return res.status(400).json({ error: 'tunnelUrl required' });

  let parsed;
  try { parsed = new URL(tunnelUrl); } catch { return res.status(400).json({ error: 'Invalid tunnelUrl' }); }
  if (!parsed.hostname.endsWith('.runonaspen.com') && parsed.hostname !== 'runonaspen.com') {
    return res.status(403).json({ error: 'tunnelUrl must be a runonaspen.com domain' });
  }

  const upstream = `${tunnelUrl.replace(/\/+$/, '')}/v1/world-model`;
  try {
    const upRes = await fetch(upstream, {
      method: 'GET',
      headers: { ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}) },
    });
    const data = await upRes.json().catch(() => ({ facts: [], owner: false }));
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ error: `Cannot reach tunnel: ${e.message}`, facts: [], owner: false });
  }
}
