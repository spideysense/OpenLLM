/**
 * /api/proxy — Chat proxy with LLM-based search intent detection
 *
 * Before sending the user's message to the local model, we run a tiny
 * pre-flight call: "Does this need real-time internet data? YES or NO"
 * ~200ms overhead, works for any question, any phrasing.
 *
 * Falls back to keyword regex if the classifier times out or fails.
 */

export const config = { runtime: 'edge' };

// ── Regex fallback (catches obvious cases if classifier fails) ──
const SEARCH_TRIGGERS = [
  /\b(stock|share)\s*(price|cost|value|ticker|quote)/i,
  /\b(weather|forecast|temperature)\b/i,
  /\b(news|latest|breaking)\b/i,
  /\b(score|result|match|game)\s*(today|tonight|yesterday)/i,
  /\b(price of|cost of|how much is|how much does)\b/i,
  /\bwho (won|is winning|leads)\b/i,
  /\b(crypto|bitcoin|ethereum|btc|eth)\s*(price|value)/i,
];

function regexShouldSearch(text) {
  return SEARCH_TRIGGERS.some(t => t.test(text));
}

// ── LLM classifier ──
const CLASSIFIER_PROMPT = `You are a search intent classifier. Your only job is to decide if a question requires real-time internet data to answer accurately.

Real-time data means: current prices, today's news, live scores, recent events, current weather, who holds a position right now, anything that changes over time.

Answer with exactly one word: YES or NO.

Question: `;

async function classifierShouldSearch(userMessage, tunnelUrl, apiKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000); // 3s max

  try {
    const res = await fetch(`${tunnelUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: 'llama3.2', // use a fast small model — will fall back gracefully if not found
        messages: [{ role: 'user', content: CLASSIFIER_PROMPT + userMessage.slice(0, 300) }],
        max_tokens: 5,
        temperature: 0,
        stream: false,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    const answer = (data.choices?.[0]?.message?.content || '').trim().toUpperCase();
    return answer.startsWith('YES');
  } catch {
    clearTimeout(timeout);
    return null; // timeout or error → fall back to regex
  }
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
    return data.results.slice(0, 5)
      .map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}${r.url ? `\nSource: ${r.url}` : ''}`)
      .join('\n\n');
  } catch { return null; }
}

function injectSearch(messages, query, results) {
  const searchBlock = `\n\n--- Live web search results for "${query}" ---\n${results}\n--- End results. Use these to answer accurately. Cite sources where relevant. ---`;
  const hasSystem = messages[0]?.role === 'system';
  if (hasSystem) {
    return [
      { ...messages[0], content: messages[0].content + searchBlock },
      ...messages.slice(1),
    ];
  }
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  return [
    { role: 'system', content: `You are a helpful private AI assistant. Today is ${dateStr}, ${timeStr}.${searchBlock}` },
    ...messages,
  ];
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

  // ── Search intent detection ──
  const lastUser = [...(messages || [])].reverse().find(m => m.role === 'user');
  const userText = lastUser?.content || '';
  let enrichedMessages = messages || [];

  if (userText.length > 3) {
    // 1. Try LLM classifier first (fast, smart)
    let needsSearch = await classifierShouldSearch(userText, tunnelUrl.replace(/\/+$/, ''), apiKey);

    // 2. If classifier failed/timed out, fall back to regex
    if (needsSearch === null) {
      needsSearch = regexShouldSearch(userText);
    }

    if (needsSearch) {
      const baseUrl = new URL(req.url).origin;
      const results = await runSearch(userText, baseUrl);
      if (results) {
        enrichedMessages = injectSearch(messages, userText.slice(0, 100), results);
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
      status: 200, headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }

  return new Response(upstreamRes.body, {
    status: 200,
    headers: { ...corsHeaders(), 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' },
  });
}

function jsonError(msg, status) {
  return new Response(JSON.stringify({ error: msg }), {
    status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': 'https://runonaspen.com',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
