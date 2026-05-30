/**
 * /api/proxy — Chat proxy with proactive web search injection
 *
 * Strategy: detect search-worthy queries by keyword BEFORE sending to model.
 * Inject search results into the system prompt. Works with ALL models,
 * no tool-call support required.
 *
 * Triggers search when the last user message contains signals like:
 * stock price, weather, news, score, latest, current price, today, etc.
 */

export const config = { runtime: 'edge' };

// Keywords that reliably indicate real-time data is needed
const SEARCH_TRIGGERS = [
  /\b(stock|share)\s*(price|cost|value|ticker|quote)/i,
  /\b(weather|forecast|temperature|rain|snow|wind)\b/i,
  /\b(news|latest|recent|current|today'?s?|right now|live)\b/i,
  /\b(score|result|match|game)\s*(today|tonight|yesterday|last night)/i,
  /\b(price of|cost of|how much is|how much does)\b/i,
  /\bwho (won|is winning|leads|is ahead)\b/i,
  /\b(election|vote|poll)\s*(result|result|winner|outcome)/i,
  /\b(crypto|bitcoin|ethereum|btc|eth)\s*(price|value|cost)/i,
  /\bwhat'?s\s+(happening|going on|the (news|score|price|weather))/i,
  /\b(released|launched|announced|dropped)\s*(today|this week|recently)/i,
];

function shouldSearch(messages) {
  const last = [...messages].reverse().find(m => m.role === 'user');
  if (!last?.content) return null;
  const text = last.content;
  for (const trigger of SEARCH_TRIGGERS) {
    if (trigger.test(text)) {
      // Extract a clean search query from the user message
      return text.slice(0, 200);
    }
  }
  return null;
}

async function runSearch(query, baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.results?.length) return null;
    return data.results
      .slice(0, 5)
      .map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}${r.url ? `\nSource: ${r.url}` : ''}`)
      .join('\n\n');
  } catch {
    return null;
  }
}

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

  // ── Detect if search is needed ──
  const searchQuery = shouldSearch(messages || []);
  let enrichedMessages = messages || [];

  if (searchQuery) {
    const baseUrl = new URL(req.url).origin;
    const searchResults = await runSearch(searchQuery, baseUrl);
    if (searchResults) {
      // Inject search results by prepending/updating the system message
      const hasSystem = enrichedMessages[0]?.role === 'system';
      const searchBlock = `\n\n--- Live web search results for "${searchQuery}" ---\n${searchResults}\n--- End search results ---\nUse these results to answer the user's question accurately. Cite sources where relevant.`;

      if (hasSystem) {
        enrichedMessages = [
          { ...enrichedMessages[0], content: enrichedMessages[0].content + searchBlock },
          ...enrichedMessages.slice(1),
        ];
      } else {
        const now = new Date();
        const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
        enrichedMessages = [
          { role: 'system', content: `You are a helpful private AI assistant. The current date is ${dateStr} and the time is ${timeStr}.${searchBlock}` },
          ...enrichedMessages,
        ];
      }
    }
  }

  // ── Call upstream ──
  let upstreamRes;
  try {
    upstreamRes = await fetch(upstream, {
      method: 'POST',
      headers: upHeaders,
      body: JSON.stringify({ model: model || 'llama3', messages: enrichedMessages, stream }),
    });
  } catch (err) {
    return jsonError(`Could not reach tunnel: ${err.message}`, 502);
  }

  if (!upstreamRes.ok) {
    const text = await upstreamRes.text().catch(() => '');
    return jsonError(`Upstream error: HTTP ${upstreamRes.status}: ${text}`, upstreamRes.status);
  }

  if (!stream) {
    const json = await upstreamRes.json();
    return new Response(JSON.stringify(json), {
      status: 200,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }

  return new Response(upstreamRes.body, {
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
