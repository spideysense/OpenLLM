/**
 * /api/proxy — Chat proxy with Aspen-level web search injection
 *
 * Regex detects obvious search queries instantly.
 * LLM classifier catches everything else (asks local model YES/NO).
 * If search needed → fetch results → inject into system prompt → stream answer.
 */
export const config = { runtime: 'edge' }; // v3

const SEARCH_TRIGGERS = [
  /\b(stock|share)\s*(price|cost|value|ticker|quote)/i,
  /\b(weather|forecast|temperature|rain|sunny|humidity)\b/i,
  /\b(news|headlines?|what'?s happening|what'?s going on)\b/i,
  /\b(latest|breaking|current events|today'?s|tonight'?s|this week'?s)\b/i,
  /\b(score|result|match|game)\s*(today|tonight|yesterday|last night)\b/i,
  /\b(price of|cost of|how much is|how much does|how much did)\b/i,
  /\bwho (won|is winning|leads|is (the )?(ceo|president|prime minister|director))\b/i,
  /\b(crypto|bitcoin|ethereum|btc|eth)\s*(price|value|cost|today)\b/i,
  /\b(released|launched|announced|dropped)\s*(today|this week|recently|just)\b/i,
  /\b(who is|who'?s)\s+the\s+(current|new|latest)\b/i,
];

const CLASSIFIER_PROMPT = `You are a search intent classifier. Does this question require real-time internet data to answer accurately? Real-time = current prices, today's news, live scores, recent events, current weather, who currently holds a position. Answer YES or NO only.\n\nQuestion: `;

async function needsSearch(userMessage, tunnelUrl, apiKey, model) {
  // Fast path: regex catches obvious cases instantly
  if (SEARCH_TRIGGERS.some(r => r.test(userMessage))) return true;

  // Classifier: ask the local model for ambiguous cases
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(`${tunnelUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: CLASSIFIER_PROMPT + userMessage.slice(0, 300) }],
        max_tokens: 5, temperature: 0, stream: false,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return false;
    const data = await res.json();
    return (data.choices?.[0]?.message?.content || '').trim().toUpperCase().startsWith('YES');
  } catch { clearTimeout(timeout); return false; }
}

async function runSearch(query) {
  try {
    const res = await fetch('https://runonaspen.com/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.results?.length) return null;
    return data.results.slice(0, 5)
      .map((r, i) => `[${i+1}] ${r.title}\n${r.snippet}${r.url ? `\nSource: ${r.url}` : ''}`)
      .join('\n\n');
  } catch { return null; }
}

function injectSearch(messages, query, results) {
  const block = `\n\n--- Web search results for "${query}" ---\n${results}\n--- End results. Answer using these results. Be direct and specific. Do NOT say you lack real-time access. ---`;
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  const hasSystem = messages[0]?.role === 'system';
  if (hasSystem) return [{ ...messages[0], content: messages[0].content + block }, ...messages.slice(1)];
  return [{ role: 'system', content: `You are a helpful private AI. Today is ${dateStr}, ${timeStr}.${block}` }, ...messages];
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  if (req.method !== 'POST') return new Response('POST only', { status: 405, headers: cors() });

  let body;
  try { body = await req.json(); } catch { return jsonErr('Invalid JSON', 400); }

  const { tunnelUrl, apiKey, model, messages, stream = true } = body;
  if (!tunnelUrl) return jsonErr('tunnelUrl required', 400);

  let parsed;
  try { parsed = new URL(tunnelUrl); } catch { return jsonErr('Invalid tunnelUrl', 400); }
  if (!parsed.hostname.endsWith('.runonaspen.com') && parsed.hostname !== 'runonaspen.com') {
    return jsonErr('tunnelUrl must be runonaspen.com domain', 403);
  }

  const upstream = `${tunnelUrl.replace(/\/+$/, '')}/v1/chat/completions`;
  const upHeaders = {
    'Content-Type': 'application/json',
    'User-Agent': 'Aspen-Proxy/1.0',
    ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
  };

  const lastUser = [...(messages || [])].reverse().find(m => m.role === 'user');
  const userText = lastUser?.content || '';
  let enrichedMessages = messages || [];

  if (userText.length > 3) {
    const shouldSearch = await needsSearch(userText, tunnelUrl.replace(/\/+$/, ''), apiKey, model || 'llama3');
    if (shouldSearch) {
      const results = await runSearch(userText);
      if (results) enrichedMessages = injectSearch(messages, userText.slice(0, 100), results);
    }
  }

  let upRes;
  try {
    upRes = await fetch(upstream, {
      method: 'POST',
      headers: upHeaders,
      body: JSON.stringify({ model: model || 'llama3', messages: enrichedMessages, stream }),
    });
  } catch (e) { return jsonErr(`Could not reach tunnel: ${e.message}`, 502); }

  if (!upRes.ok) {
    const t = await upRes.text().catch(() => '');
    return jsonErr(`Upstream HTTP ${upRes.status}: ${t.slice(0, 200)}`, upRes.status);
  }

  if (!stream) {
    const json = await upRes.json();
    return new Response(JSON.stringify(json), { status: 200, headers: { ...cors(), 'Content-Type': 'application/json' } });
  }

  return new Response(upRes.body, {
    status: 200,
    headers: { ...cors(), 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' },
  });
}

function jsonErr(msg, status) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { ...cors(), 'Content-Type': 'application/json' } });
}
function cors() {
  return {
    'Access-Control-Allow-Origin': 'https://runonaspen.com',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
