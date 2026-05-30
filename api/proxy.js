/**
 * /api/proxy — Chat proxy with web search tool-use loop
 *
 * Flow:
 * 1. First call to local Ollama with web_search tool defined
 * 2. If model calls web_search → run /api/search → inject results as tool response
 * 3. Second call to Ollama with search results → stream final answer back
 *
 * Falls back gracefully if model doesn't support tools.
 */

export const config = { runtime: 'edge' };

const WEB_SEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'web_search',
    description: 'Search the web for current information, news, facts, or anything that requires up-to-date data. Use this when asked about recent events, current prices, today\'s weather, live information, or anything you\'re not confident about.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query to look up',
        },
      },
      required: ['query'],
    },
  },
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (req.method !== 'POST') {
    return new Response('POST only', { status: 405, headers: corsHeaders() });
  }

  let body;
  try { body = await req.json(); }
  catch { return jsonError('Invalid JSON', 400); }

  const { tunnelUrl, apiKey, model, messages, stream = true } = body;

  if (!tunnelUrl || typeof tunnelUrl !== 'string') return jsonError('tunnelUrl required', 400);

  let parsed;
  try { parsed = new URL(tunnelUrl); }
  catch { return jsonError('Invalid tunnelUrl', 400); }

  if (!parsed.hostname.endsWith('.runonaspen.com') && parsed.hostname !== 'runonaspen.com') {
    return jsonError('tunnelUrl must be a runonaspen.com domain', 403);
  }

  const upstream = `${tunnelUrl.replace(/\/+$/, '')}/v1/chat/completions`;
  const upHeaders = {
    'Content-Type': 'application/json',
    'User-Agent': 'Aspen-Web-Proxy/1.0',
    ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
  };

  // ── Step 1: call with tool definition (non-streaming first pass) ──
  let firstRes;
  try {
    firstRes = await fetch(upstream, {
      method: 'POST',
      headers: upHeaders,
      body: JSON.stringify({
        model: model || 'llama3',
        messages: messages || [],
        tools: [WEB_SEARCH_TOOL],
        tool_choice: 'auto',
        stream: false,
      }),
    });
  } catch (err) {
    return jsonError(`Could not reach tunnel: ${err.message}`, 502);
  }

  // If tool_choice not supported by this model version, fall through to plain streaming
  let firstData = null;
  if (firstRes.ok) {
    try { firstData = await firstRes.json(); } catch {}
  }

  // ── Step 2: check if model wants to call web_search ──
  const toolCalls = firstData?.choices?.[0]?.message?.tool_calls;
  const searchCall = toolCalls?.find(tc => tc.function?.name === 'web_search');

  if (searchCall) {
    // Parse query
    let searchQuery = '';
    try {
      const args = JSON.parse(searchCall.function.arguments || '{}');
      searchQuery = args.query || '';
    } catch {}

    // Run the search
    let searchResults = [];
    if (searchQuery) {
      try {
        const baseUrl = new URL(req.url).origin;
        const sRes = await fetch(`${baseUrl}/api/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: searchQuery }),
        });
        if (sRes.ok) {
          const sData = await sRes.json();
          searchResults = sData.results || [];
        }
      } catch {}
    }

    // Format search results as tool response
    const toolResultContent = searchResults.length > 0
      ? searchResults.map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}${r.url ? `\nSource: ${r.url}` : ''}`).join('\n\n')
      : 'No results found.';

    // ── Step 3: second call with tool result → stream final answer ──
    const messagesWithTool = [
      ...(messages || []),
      firstData.choices[0].message, // assistant message with tool_calls
      {
        role: 'tool',
        tool_call_id: searchCall.id,
        content: toolResultContent,
      },
    ];

    let finalRes;
    try {
      finalRes = await fetch(upstream, {
        method: 'POST',
        headers: upHeaders,
        body: JSON.stringify({
          model: model || 'llama3',
          messages: messagesWithTool,
          stream: stream,
        }),
      });
    } catch (err) {
      return jsonError(`Could not reach tunnel on second call: ${err.message}`, 502);
    }

    if (!finalRes.ok) {
      const text = await finalRes.text().catch(() => '');
      return jsonError(`Upstream error: HTTP ${finalRes.status}: ${text}`, finalRes.status);
    }

    if (!stream) {
      const json = await finalRes.json();
      return new Response(JSON.stringify(json), {
        status: 200,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      });
    }

    return new Response(finalRes.body, {
      status: 200,
      headers: { ...corsHeaders(), 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' },
    });
  }

  // ── No tool call — if we got a valid response already, stream it or return it ──
  // If the model returned a plain text response (no tool call), re-request with streaming
  // OR stream the content we already have from firstData

  if (firstData?.choices?.[0]?.message?.content && !stream) {
    return new Response(JSON.stringify(firstData), {
      status: 200,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }

  // Re-call with streaming for the UI
  let streamRes;
  try {
    streamRes = await fetch(upstream, {
      method: 'POST',
      headers: upHeaders,
      body: JSON.stringify({
        model: model || 'llama3',
        messages: messages || [],
        stream: stream,
      }),
    });
  } catch (err) {
    return jsonError(`Could not reach tunnel: ${err.message}`, 502);
  }

  if (!streamRes.ok) {
    const text = await streamRes.text().catch(() => '');
    return jsonError(`Upstream error: HTTP ${streamRes.status}: ${text}`, streamRes.status);
  }

  if (!stream) {
    const json = await streamRes.json();
    return new Response(JSON.stringify(json), {
      status: 200,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }

  return new Response(streamRes.body, {
    status: 200,
    headers: { ...corsHeaders(), 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' },
  });
}

function jsonError(msg, status) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': 'https://runonaspen.com',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
