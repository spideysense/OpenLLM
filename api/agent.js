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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
    'X-Aspen-Proxy': 'agent-v2',
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
  // GET = health check. Visit runonaspen.com/api/agent in a browser to confirm
  // THIS version is the one actually deployed (returns the marker below).
  if (req.method === 'GET') {
    return new Response(JSON.stringify({ ok: true, version: 'agent-v2', ts: Date.now() }), {
      status: 200, headers: { ...cors(origin), 'Content-Type': 'application/json' },
    });
  }
  if (req.method !== 'POST') return jsonErr('POST only', 405, origin);

  // Whole body wrapped: this function must NEVER return an opaque
  // FUNCTION_INVOCATION_FAILED. Any unexpected throw is caught and returned as a
  // real, readable error the app can show (and we can debug).
  try {
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

    // STREAMING — open the response stream IMMEDIATELY so Vercel's first-byte
    // window is satisfied before the agent loop runs. Every step here is
    // defensive: a throw inside start() must emit an SSE error, never crash.
    const encoder = new TextEncoder();
    const streamBody = new ReadableStream({
      start(controller) {
        const enq = (s) => { try { controller.enqueue(encoder.encode(s)); } catch {} };
        // Flush a byte immediately so the response is "started". NO setInterval —
        // it was the crash suspect and isn't needed: once the upstream agent
        // streams, its own tokens keep the connection alive.
        enq(': connected\n\n');

        (async () => {
          try {
            const upRes = await fetch(upstream, { method: 'POST', headers: upHeaders, body: upBody });
            if (!upRes.ok || !upRes.body) {
              const t = await upRes.text().catch(() => '');
              enq(`data: ${JSON.stringify({ error: `Upstream ${upRes.status}: ${t.slice(0, 200)}` })}\n\n`);
              enq('data: [DONE]\n\n');
              return;
            }
            const reader = upRes.body.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              try { controller.enqueue(value); } catch { break; }
            }
          } catch (e) {
            enq(`data: ${JSON.stringify({ error: `Cannot reach tunnel: ${e && e.message ? e.message : e}` })}\n\n`);
            enq('data: [DONE]\n\n');
          } finally {
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
  } catch (e) {
    // Last resort — turn an opaque FUNCTION_INVOCATION_FAILED into a readable
    // error so the app shows something useful and we can see the real cause.
    return jsonErr(`agent proxy error: ${e && e.message ? e.message : String(e)}`, 500, origin);
  }
}
