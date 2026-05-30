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

export const config = { runtime: 'edge' };

const CLASSIFIER_PROMPT = `You are a search intent classifier. Your only job is to decide if this question requires real-time internet data to answer accurately.

Real-time data means: current prices, today's news, live scores, recent events, current weather, who currently holds a position, anything that changes over time and you wouldn't know without checking.

Answer with exactly one word: YES or NO.

Question: `;

async function askModelIfSearchNeeded(userMessage, tunnelUrl, apiKey, model) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000); // 4s — generous but capped
  try {
    const res = await fetch(`${tunnelUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: CLASSIFIER_PROMPT + userMessage.slice(0, 400) }],
        max_tokens: 5,
        temperature: 0,
        stream: false,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return false;
    const data = await res.json();
    const answer = (data.choices?.[0]?.message?.content || '').trim().toUpperCase();
    return answer.startsWith('YES');
  } catch {
    clearTimeout(timeout);
    return false; // timed out or failed → don't search, just answer
  }
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
  const searchBlock = `\n\n--- Live web search results for "${query}" ---\n${results}\n--- End results. Use these to answer accurately. Cite sources where relevant. ---`;
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
