/**
 * /api/agent — routes chat through the gateway's agent loop.
 *
 * Unlike /api/proxy (which hits Ollama directly), this goes through
 * /v1/agent on the user's machine: web_search, calculate, run_command,
 * computer use, and every other tool all execute on the Aspen machine.
 *
 * The gateway enforces its own auth and owner-key checks — this Vercel
 * function is purely a streaming pass-through to the tunnel.
 */
export const config = { runtime: 'edge' };

const ALLOWED_ORIGINS = [
  'https://runonaspen.com',
  'https://www.runonaspen.com',
  'capacitor://localhost',
  'ionic://localhost',
  'http://localhost',
  'https://localhost',
];

function cors(origin) {
  const allow = (ALLOWED_ORIGINS.includes(origin) || (origin && origin.endsWith('.runonaspen.com')))
    ? origin : 'https://runonaspen.com';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function jsonErr(msg, status, origin) {
  return new Response(JSON.stringify({ error: msg }), {
    status, headers: { ...cors(origin), 'Content-Type': 'application/json' },
  });
}

export default async function handler(req) {
  const origin = req.headers.get('origin') || '';
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== 'POST') return jsonErr('POST only', 405, origin);

  let body;
  try { body = await req.json(); } catch { return jsonErr('Invalid JSON', 400, origin); }

  const { tunnelUrl, apiKey, model, messages, stream = true } = body;
  if (!tunnelUrl) return jsonErr('tunnelUrl required', 400, origin);

  let parsed;
  try { parsed = new URL(tunnelUrl); } catch { return jsonErr('Invalid tunnelUrl', 400, origin); }
  if (!parsed.hostname.endsWith('.runonaspen.com') && parsed.hostname !== 'runonaspen.com') {
    return jsonErr('tunnelUrl must be a runonaspen.com domain', 403, origin);
  }

  const upstream = `${tunnelUrl.replace(/\/+$/, '')}/v1/agent`;
  const upHeaders = {
    'Content-Type': 'application/json',
    'User-Agent': 'Aspen-AgentProxy/1.0',
    ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
  };
  const upBody = JSON.stringify({ model, messages, stream });

  // NON-STREAMING
  if (!stream) {
    let upRes;
    try { upRes = await fetch(upstream, { method: 'POST', headers: upHeaders, body: upBody }); }
    catch (e) { return jsonErr(`Cannot reach tunnel: ${e.message}`, 502, origin); }
    if (!upRes.ok) {
      const t = await upRes.text().catch(() => '');
      return jsonErr(`Upstream ${upRes.status}: ${t.slice(0, 200)}`, upRes.status, origin);
    }
    return new Response(JSON.stringify(await upRes.json()), {
      status: 200,
      headers: { ...cors(origin), 'Content-Type': 'application/json' },
    });
  }

  // STREAMING — open the response stream IMMEDIATELY so Vercel's 25s
  // first-byte window is satisfied before the agent loop runs.
  const encoder = new TextEncoder();
  const streamBody = new ReadableStream({
    start(controller) {
      // Flush a keep-alive comment now so the response is "started"
      controller.enqueue(encoder.encode(': connected\n\n'));
      let alive = true;

      // Periodic keep-alive — prevents proxy/Vercel from closing a long tool chain
      const heartbeat = setInterval(() => {
        if (alive) { try { controller.enqueue(encoder.encode(': keep-alive\n\n')); } catch {} }
      }, 8000);

      // All real work in a detached async task — start() must not await or
      // the first byte won't flush before the 25s deadline.
      (async () => {
        try {
          const upRes = await fetch(upstream, { method: 'POST', headers: upHeaders, body: upBody });
          if (!upRes.ok || !upRes.body) {
            const t = await upRes.text().catch(() => '');
            controller.enqueue(encoder.encode(
              `data: ${JSON.stringify({ error: `Upstream ${upRes.status}: ${t.slice(0, 200)}` })}\n\n`
            ));
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            return;
          }
          const reader = upRes.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        } catch (e) {
          try {
            controller.enqueue(encoder.encode(
              `data: ${JSON.stringify({ error: `Cannot reach tunnel: ${e.message}` })}\n\n`
            ));
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          } catch {}
        } finally {
          alive = false;
          clearInterval(heartbeat);
          try { controller.close(); } catch {}
        }
      })();
    },
  });

  return new Response(streamBody, {
    status: 200,
    headers: {
      ...cors(origin),
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  });
}
