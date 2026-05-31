/**
 * /api/proxy — Chat proxy with Aspen-level LLM search intent detection
 *
 * Aspen asks the local model: "Does this require real-time internet data? YES or NO"
 * If YES → search → inject results → stream answer. No regex, no hardcoding.
 * If the classifier times out or fails → skip search, answer directly.
 *
 * The search tool is at the ASPEN level: works identically regardless of
 * which local model is active (Qwen, Llama, DeepSeek, Mistral, etc.)
 */

export const config = { runtime: 'edge' }; // v2 — keyword search + LLM classifier

// Instant keyword check — catches obvious cases with zero latency
const OBVIOUS_SEARCH = [
  /(news|headline|headlines|what'?s happening|latest|today'?s|tonight|this week|right now|currently)/i,
  /(stock|share price|market|crypto|bitcoin|ethereum|btc|eth)/i,
  /(weather|temperature|forecast|rain|sunny|humidity)/i,
  /(score|who won|winner|match result|game today|game tonight)/i,
  /(who is (the|a|an)|who'?s (the|currently)|current (president|ceo|prime minister|chancellor))/i,
  /(released|launched|announced|available now|just dropped)/i,
  /(price of|cost of|how much (is|does|did))/i,
];

const CLASSIFIER_PROMPT = `You are a search intent classifier. Does this question require real-time internet data? Real-time = current prices, today's news, live scores, recent events, current weather, who holds a position now. Answer YES or NO only.

Question: `;

async function askModelIfSearchNeeded(userMessage, tunnelUrl, apiKey, model) {
  // 1. Instant keyword check — zero latency
  if (OBVIOUS_SEARCH.some(r => r.test(userMessage))) return true;

  // 2. LLM classifier with tight 2s timeout (model already running, should be fast)
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(`${tunnelUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: CLASSIFIER_PROMPT + userMessage.slice(0, 300) }], max_tokens: 5, temperature: 0, stream: false }),
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
  const searchBlock = `\n\n--- Live web search results for "${query}" ---\n${results}\n--- End of search results ---\n\nIMPORTANT: Use the search results above to answer the user's question directly and concisely. Do NOT write code. Just answer the question in plain English using the data from the search results.`;
  const hasSystem = messages[0]?.role === 'system';
  if (hasSystem) {
    return [{ ...messages[0], content: messages[0].content + searchBlock }, ...messages.slice(1)];
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
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
  if (req.method !== 'POST') return new Response('POST only', { status: 405, headers: corsHeaders() });

  let body;
  try { body = await req.json(); } catch { return jsonError('Invalid JSON', 400); }

  const { tunnelUrl, apiKey, model, messages, stream = true } = body;
  if (!tunnelUrl) return jsonError('tunnelUrl required', 400);

  let parsed;
  try { parsed = new URL(tunnelUrl); } catch { return jsonError('Invalid tunnelUrl', 400); }
  if (!parsed.hostname.endsWith('.runonaspen.com') && parsed.hostname !== 'runonaspen.com') {
    return jsonError('tunnelUrl must be a runonaspen.com domain', 403);
  }

  const upstream = `${tunnelUrl.replace(/\/+$/, '')}/v1/chat/completions`;
  const upHeaders = {
    'Content-Type': 'application/json',
    'User-Agent': 'Aspen-Web-Proxy/1.0',
    ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
  };

  // ── Aspen-level search intent detection ──
  const lastUser = [...(messages || [])].reverse().find(m => m.role === 'user');
  const userText = lastUser?.content || '';
  let enrichedMessages = messages || [];

  if (userText.length > 3 && model) {
    const needsSearch = await askModelIfSearchNeeded(
      userText,
      tunnelUrl.replace(/\/+$/, ''),
      apiKey,
      model
    );
    if (needsSearch) {
      const results = await runSearch(userText);
      if (results) enrichedMessages = injectSearch(messages, userText.slice(0, 120), results);
    }
  }

  // ── Stream to local model ──
  let upstreamRes;
  try {
    upstreamRes = await fetch(upstream, {
      method: 'POST',
      headers: upHeaders,
      body: JSON.stringify({ model: model || 'llama3', messages: enrichedMessages, stream }),
    });
  } catch (err) { return jsonError(`Could not reach tunnel: ${err.message}`, 502); }

  if (!upstreamRes.ok) {
    const text = await upstreamRes.text().catch(() => '');
    return jsonError(`HTTP ${upstreamRes.status}: ${text}`, upstreamRes.status);
  }

  if (!stream) {
    const json = await upstreamRes.json();
    return new Response(JSON.stringify(json), { status: 200, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } });
  }

  return new Response(upstreamRes.body, {
    status: 200,
    headers: { ...corsHeaders(), 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' },
  });
}

function jsonError(msg, status) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } });
}
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': 'https://runonaspen.com',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
