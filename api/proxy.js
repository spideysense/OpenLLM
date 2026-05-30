/**
 * /api/proxy — Streaming chat proxy for the Aspen web app
 *
 * Cloudflare blocks direct browser POST requests to tunnel subdomains.
 * This route runs server-side on Vercel, which CAN reach the tunnel.
 * The browser sends here; we forward to the user's tunnel and stream back.
 *
 * Privacy note: Vercel sees the request in transit but stores nothing.
 * The tunnel URL and API key come from the client on each request.
 */

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }

  if (req.method !== 'POST') {
    return new Response('POST only', { status: 405, headers: corsHeaders() });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }

  const { tunnelUrl, apiKey, model, messages } = body;

  if (!tunnelUrl || typeof tunnelUrl !== 'string') {
    return new Response(JSON.stringify({ error: 'tunnelUrl required' }), {
      status: 400,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }

  // Sanitize tunnel URL — must be a runonaspen.com subdomain
  let parsed;
  try {
    parsed = new URL(tunnelUrl);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid tunnelUrl' }), {
      status: 400,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }

  if (!parsed.hostname.endsWith('.runonaspen.com') && parsed.hostname !== 'runonaspen.com') {
    return new Response(JSON.stringify({ error: 'tunnelUrl must be a runonaspen.com domain' }), {
      status: 403,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }

  const upstream = `${tunnelUrl.replace(/\/+$/, '')}/v1/chat/completions`;

  const upstreamHeaders = {
    'Content-Type': 'application/json',
    'User-Agent': 'Aspen-Web-Proxy/1.0',
  };
  if (apiKey) upstreamHeaders['Authorization'] = `Bearer ${apiKey}`;

  let upstreamRes;
  try {
    upstreamRes = await fetch(upstream, {
      method: 'POST',
      headers: upstreamHeaders,
      body: JSON.stringify({ model: model || 'llama3', messages: messages || [], stream: true }),
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Could not reach tunnel', detail: err.message }), {
      status: 502,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }

  if (!upstreamRes.ok) {
    const text = await upstreamRes.text().catch(() => '');
    return new Response(JSON.stringify({ error: `Upstream error: HTTP ${upstreamRes.status}`, detail: text }), {
      status: upstreamRes.status,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }

  // Stream the SSE response straight back to the browser
  return new Response(upstreamRes.body, {
    status: 200,
    headers: {
      ...corsHeaders(),
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': 'https://runonaspen.com',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
