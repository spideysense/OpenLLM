/**
 * /api/proxy — Chat proxy with Aspen-level web search
 *
 * Search logic is INLINED here — no self-HTTP call to /api/search.
 * That was causing "Host not in allowlist" 403s on Vercel.
 */
export const config = { runtime: 'edge' };

// ── Search triggers (regex) ──────────────────────────────
const SEARCH_TRIGGERS = [
  /\b(stock|share)\s*(price|cost|value|ticker|quote)/i,
  /\b(weather|forecast|temperature|rain|sunny|humidity)\b/i,
  /\b(news|headlines?|what'?s happening|what'?s going on)\b/i,
  /\b(latest|breaking|current events|today'?s|tonight'?s|this week'?s)\b/i,
  /\b(score|result|match|game)\s*(today|tonight|yesterday|last night)\b/i,
  /\b(price of|cost of|how much is|how much does|how much did)\b/i,
  /\bwho (won|is winning|leads|is (the )?(ceo|president|prime minister))\b/i,
  /\b(crypto|bitcoin|ethereum|btc|eth)\s*(price|value|cost|today)\b/i,
  /\b(released|launched|announced|dropped)\s*(today|this week|recently|just)\b/i,
];

const CLASSIFIER_PROMPT = `You are a search intent classifier. Does this question require real-time internet data to answer accurately? Real-time = current prices, today's news, live scores, recent events, current weather, who currently holds a position. Answer YES or NO only.\n\nQuestion: `;

async function classifierNeedsSearch(userMessage, tunnelUrl, apiKey, model) {
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

// ── Search execution (Brave HTML + Google News RSS) ─────
async function fetchSearchResults(query) {
  // Primary: Brave Search HTML (full web results, not blocked from servers)
  try {
    const res = await fetch(`https://search.brave.com/search?q=${encodeURIComponent(query)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (res.ok) {
      const html = await res.text();
      const results = [];
      const blocks = html.split('data-type="web"');
      for (const b of blocks.slice(1, 9)) {
        const urlM = b.match(/<a href="(https?:\/\/[^"]+)"/);
        const titleM = b.match(/search-snippet-title[^>]*title="([^"]+)"/) || b.match(/search-snippet-title[^>]*>([^<]+)</);
        const snipM = b.match(/line-clamp-dynamic[^>]*>(?:<!--[^>]*-->)*\s*(?:<!---->)?\s*([^<]+)</);
        const url = urlM ? urlM[1] : '';
        const title = titleM ? titleM[1].replace(/&amp;/g, '&').replace(/&#x27;/g, "'").trim() : '';
        const snippet = snipM ? snipM[1].replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim() : '';
        if (title && url) results.push({ title, url, snippet });
      }
      if (results.length > 0) return results.slice(0, 6);
    }
  } catch {}

  // Fallback: Google News RSS (for news queries when Brave returns nothing)
  try {
    const res = await fetch(
      `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (res.ok) {
      const xml = await res.text();
      const results = [];
      const items = xml.split('<item>').slice(1, 7);
      for (const item of items) {
        const titleM = item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
        const linkM = item.match(/<link>([\s\S]*?)<\/link>/);
        const descM = item.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/);
        const title = titleM ? titleM[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim() : '';
        const url = linkM ? linkM[1].trim() : '';
        const snippet = descM ? descM[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().slice(0, 200) : '';
        if (title) results.push({ title, url, snippet });
      }
      if (results.length > 0) return results.slice(0, 6);
    }
  } catch {}

  return [];
}

function injectSearch(messages, query, results) {
  const formatted = results
    .map((r, i) => `[${i+1}] ${r.title}\n${r.snippet}${r.url ? `\nSource: ${r.url}` : ''}`)
    .join('\n\n');
  const block = `\n\n--- Web search results for "${query}" ---\n${formatted}\n--- End results. Answer using these results directly. Do NOT say you lack internet access. ---`;
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  const hasSystem = messages[0]?.role === 'system';
  if (hasSystem) return [{ ...messages[0], content: messages[0].content + block }, ...messages.slice(1)];
  return [{ role: 'system', content: `You are a helpful private AI. Today is ${dateStr}, ${timeStr}.${block}` }, ...messages];
}

// ── Main handler ─────────────────────────────────────────
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
    // Regex first — instant, no network
    const regexHit = SEARCH_TRIGGERS.some(r => r.test(userText));
    // Classifier only if regex misses
    const shouldSearch = regexHit || await classifierNeedsSearch(
      userText, tunnelUrl.replace(/\/+$/, ''), apiKey, model || 'llama3'
    );
    if (shouldSearch) {
      const results = await fetchSearchResults(userText);
      if (results.length > 0) enrichedMessages = injectSearch(messages, userText.slice(0, 100), results);
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
    return new Response(JSON.stringify(await upRes.json()), {
      status: 200, headers: { ...cors(), 'Content-Type': 'application/json' },
    });
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
