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

// ── SearXNG: open-source metasearch, stable JSON API, no key ─────
// Public instances vary in uptime and whether format=json is enabled,
// so we try several in order and use the first that returns results.
// Verify which instances work from your Mac (curl) and reorder accordingly.
const SEARXNG_INSTANCES = [
  'https://searx.be',
  'https://search.inetol.net',
  'https://baresearch.org',
  'https://searx.tiekoetter.com',
];

async function fetchSearXNG(query) {
  for (const base of SEARXNG_INSTANCES) {
    try {
      const url = `${base}/search?q=${encodeURIComponent(query)}&format=json&categories=general,news&language=en`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) continue;
      // Some instances return HTML (json disabled) even on success — guard the parse.
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('json')) continue;
      const data = await res.json();
      const results = (data.results || [])
        .filter(r => r.title && r.url)
        .slice(0, 6)
        .map(r => ({
          title: String(r.title).trim(),
          url: r.url,
          snippet: (r.content || '').replace(/\s+/g, ' ').trim().slice(0, 220),
        }));
      if (results.length > 0) return results;
    } catch { /* try next instance */ }
  }
  return [];
}

// ── Search execution: SearXNG (primary) → Brave scrape → Google News ─────
async function fetchSearchResults(query) {
  // Primary: SearXNG — broad web results via stable JSON, multi-instance fallback.
  const searx = await fetchSearXNG(query);
  if (searx.length > 0) return searx;

  // Fallback 1: Brave Search HTML (full web results, not blocked from servers)
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

  // Fallback 2: Google News RSS (for news queries when others return nothing)
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
  const origin = req.headers.get('origin') || '';
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== 'POST') return new Response('POST only', { status: 405, headers: cors(origin) });

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

  // Search enrichment (classifier + web results) makes network calls and can be
  // slow. We DON'T run it before opening the stream — doing so ate into Vercel's
  // 25s "first byte" window and caused FUNCTION_INVOCATION_TIMEOUT / 504. Instead,
  // for streaming we open the stream first (first byte out instantly), then run
  // search inside the stream while heartbeats keep the connection alive.
  const SEARCH_DEADLINE_MS = 5000;
  async function enrich() {
    if (userText.length <= 3) return messages || [];
    try {
      return await Promise.race([
        (async () => {
          // Use only the LLM classifier (not keyword regex) to decide if search is
          // needed. Regex caused false positives on code-gen prompts containing
          // trigger words like "weather" or "news" — the user wanted code, not data.
          const shouldSearch = await classifierNeedsSearch(
            userText, tunnelUrl.replace(/\/+$/, ''), apiKey, model || 'llama3'
          );
          if (shouldSearch) {
            const results = await fetchSearchResults(userText);
            if (results.length > 0) return injectSearch(messages, userText.slice(0, 100), results);
          }
          return messages || [];
        })(),
        new Promise(resolve => setTimeout(() => resolve(messages || []), SEARCH_DEADLINE_MS)),
      ]);
    } catch { return messages || []; }
  }

  // For non-streaming, enrich synchronously (that path opts out of streaming).
  let enrichedMessages = messages || [];
  if (!stream) { enrichedMessages = await enrich(); }

  // NON-STREAMING: fetch fully, then return. (Subject to the 25s init limit, but
  // non-stream callers opt out of streaming deliberately.)
  if (!stream) {
    let upRes;
    try {
      upRes = await fetch(upstream, {
        method: 'POST', headers: upHeaders,
        body: JSON.stringify({ model: model || 'llama3', messages: enrichedMessages, stream: false }),
      });
    } catch (e) { return jsonErr(`Could not reach tunnel: ${e.message}`, 502); }
    if (!upRes.ok) {
      const t = await upRes.text().catch(() => '');
      return jsonErr(`Upstream HTTP ${upRes.status}: ${t.slice(0, 200)}`, upRes.status);
    }
    return new Response(JSON.stringify(await upRes.json()), {
      status: 200, headers: { ...cors(origin), 'Content-Type': 'application/json' },
    });
  }

  // STREAMING: open the response stream IMMEDIATELY and flush a keep-alive comment
  // before contacting the (possibly slow) local model. Vercel's edge runtime kills
  // a function that doesn't return an initial response within 25s — but a streaming
  // response counts as "returned" the instant the first byte goes out. So we send a
  // byte now, then fetch upstream and pump its tokens whenever they arrive. This is
  // why a slow model no longer produces FUNCTION_INVOCATION_TIMEOUT / HTTP 504.
  const encoder = new TextEncoder();
  const streamBody = new ReadableStream({
    start(controller) {
      // CRITICAL: start() must NOT be async / must NOT await the work. If start()
      // is async and awaits, Vercel buffers the whole stream until it resolves and
      // the first byte never flushes early — which is what caused the 504. Instead
      // we flush ': connected' now and run the pump in a DETACHED async task, so the
      // function counts as "responded" within the 25s window regardless of model speed.
      controller.enqueue(encoder.encode(': connected\n\n'));
      let alive = true;
      const heartbeat = setInterval(() => {
        if (alive) { try { controller.enqueue(encoder.encode(': keep-alive\n\n')); } catch {} }
      }, 8000);

      (async () => {
        try {
          const enriched = await enrich();
          const upRes = await fetch(upstream, {
            method: 'POST', headers: upHeaders,
            body: JSON.stringify({ model: model || 'llama3', messages: enriched, stream: true }),
          });
          if (!upRes.ok || !upRes.body) {
            const t = await upRes.text().catch(() => '');
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: `Upstream HTTP ${upRes.status}: ${t.slice(0,200)}` })}\n\n`));
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            return;
          }
          const reader = upRes.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value); // pass model tokens straight through
          }
        } catch (e) {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: `Could not reach tunnel: ${e.message}` })}\n\n`));
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
    headers: { ...cors(origin), 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' },
  });
}

function jsonErr(msg, status) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { ...cors(origin), 'Content-Type': 'application/json' } });
}
const ALLOWED_ORIGINS = [
  'https://runonaspen.com',
  'capacitor://localhost',
  'ionic://localhost',
  'http://localhost',
  'https://localhost',
];
function cors(origin) {
  // Echo back the origin if it's an allowed app origin; default to the site.
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : 'https://runonaspen.com';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}
