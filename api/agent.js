/**
 * /api/agent — Node.js runtime (NOT edge).
 *
 * The Edge runtime (edge-on-lambda) was crashing at the PLATFORM level
 * (ProcessExitedPrematurelyError, /tmp/sources/config.capnp) — the edge child
 * process exits before our code runs, so no try/catch in the handler could help.
 * The standard Node runtime sidesteps the broken edge runtime entirely.
 *
 * Streams Server-Sent Events from the user's gateway (/v1/agent via the tunnel)
 * straight through to the browser.
 */
export const config = { maxDuration: 60 };

const ALLOWED_ORIGINS = [
  'https://runonaspen.com',
  'https://www.runonaspen.com',
  'capacitor://localhost',
  'ionic://localhost',
  'http://localhost',
  'https://localhost',
];

function setCors(res, origin) {
  const allow = (ALLOWED_ORIGINS.includes(origin) || (origin && origin.endsWith('.runonaspen.com')))
    ? origin : 'https://runonaspen.com';
  res.setHeader('Access-Control-Allow-Origin', allow);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
  res.setHeader('X-Aspen-Proxy', 'agent-node-v3');
}

function endJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  setCors(res, origin);

  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  // GET = health check. Visit /api/agent in a browser to confirm the deployed
  // version (returns the marker below) without DevTools.
  if (req.method === 'GET') return endJson(res, 200, { ok: true, version: 'agent-node-v3', ts: Date.now() });
  if (req.method !== 'POST') return endJson(res, 405, { error: 'POST only' });

  // Body — Vercel usually pre-parses JSON, but read the raw stream if not.
  let body = req.body;
  if (!body || typeof body === 'string') {
    try {
      if (typeof body === 'string' && body.trim()) {
        body = JSON.parse(body);
      } else {
        const chunks = [];
        for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
        body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
      }
    } catch { return endJson(res, 400, { error: 'Invalid JSON' }); }
  }
  body = body || {};

  const { tunnelUrl, apiKey, model, messages } = body;
  if (!tunnelUrl) return endJson(res, 400, { error: 'tunnelUrl required' });

  let parsed;
  try { parsed = new URL(tunnelUrl); } catch { return endJson(res, 400, { error: 'Invalid tunnelUrl' }); }
  if (!parsed.hostname.endsWith('.runonaspen.com') && parsed.hostname !== 'runonaspen.com') {
    return endJson(res, 403, { error: 'tunnelUrl must be a runonaspen.com domain' });
  }

  const upstream = `${tunnelUrl.replace(/\/+$/, '')}/v1/agent`;
  const upHeaders = {
    'Content-Type': 'application/json',
    'User-Agent': 'Aspen-AgentProxy/1.0',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
  const upBody = JSON.stringify({ model, messages, stream: true });

  // Start the SSE stream immediately.
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Connection', 'keep-alive');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  res.write(': connected\n\n');

  try {
    const upRes = await fetch(upstream, { method: 'POST', headers: upHeaders, body: upBody });
    if (!upRes.ok || !upRes.body) {
      const t = await upRes.text().catch(() => '');
      res.write(`data: ${JSON.stringify({ error: `Upstream ${upRes.status}: ${t.slice(0, 200)}` })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    const reader = upRes.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (e) {
    try {
      res.write(`data: ${JSON.stringify({ error: `Cannot reach tunnel: ${e && e.message ? e.message : e}` })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } catch {}
  }
}
