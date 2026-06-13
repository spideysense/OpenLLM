/**
 * /api/proxy — Chat proxy with Aspen-level web search
 *
 * Search logic is INLINED here — no self-HTTP call to /api/search.
 * That was causing "Host not in allowlist" 403s on Vercel.
 */
export const config = { maxDuration: 60 };

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
export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  setCors(res, origin);

  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  if (req.method === 'GET') return endJson(res, 200, { ok: true, version: 'proxy-node-v1', ts: Date.now() });
  if (req.method !== 'POST') return endJson(res, 405, { error: 'POST only' });

  // Body — Vercel usually pre-parses JSON; read the raw stream if not.
  let body = req.body;
  if (!body || typeof body === 'string') {
    try {
      if (typeof body === 'string' && body.trim()) {
        body = JSON.parse(body);
      } else {
        const chunks = [];
        for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
        body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
      }
    } catch { return endJson(res, 400, { error: 'Invalid JSON' }); }
  }
  body = body || {};

  const { tunnelUrl, apiKey, model, messages, stream = true } = body;
  if (!tunnelUrl) return endJson(res, 400, { error: 'tunnelUrl required' });

  let parsed;
  try { parsed = new URL(tunnelUrl); } catch { return endJson(res, 400, { error: 'Invalid tunnelUrl' }); }
  if (!parsed.hostname.endsWith('.runonaspen.com') && parsed.hostname !== 'runonaspen.com') {
    return endJson(res, 403, { error: 'tunnelUrl must be a runonaspen.com domain' });
  }

  const upstream = `${tunnelUrl.replace(/\/+$/, '')}/v1/chat/completions`;
  const upHeaders = {
    'Content-Type': 'application/json',
    'User-Agent': 'Aspen-Proxy/1.0',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };

  // NON-STREAMING (world-model extraction): Node gives up to maxDuration (60s)
  // instead of the edge runtime's ~25s ceiling — that ceiling was the 504 cause.
  if (!stream) {
    try {
      const upRes = await fetch(upstream, {
        method: 'POST', headers: upHeaders,
        body: JSON.stringify({ model: model || 'llama3', messages: messages || [], stream: false }),
      });
      if (!upRes.ok) {
        const t = await upRes.text().catch(() => '');
        return endJson(res, upRes.status, { error: `Upstream HTTP ${upRes.status}: ${t.slice(0, 200)}` });
      }
      return endJson(res, 200, await upRes.json());
    } catch (e) {
      return endJson(res, 502, { error: `Could not reach tunnel: ${e && e.message ? e.message : e}` });
    }
  }

  // STREAMING (voice chat): open SSE immediately, then pipe model tokens through.
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Connection', 'keep-alive');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  res.write(': connected\n\n');

  try {
    const upRes = await fetch(upstream, {
      method: 'POST', headers: upHeaders,
      body: JSON.stringify({ model: model || 'llama3', messages: messages || [], stream: true }),
    });
    if (!upRes.ok || !upRes.body) {
      const t = await upRes.text().catch(() => '');
      res.write(`data: ${JSON.stringify({ error: `Upstream HTTP ${upRes.status}: ${t.slice(0, 200)}` })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    const reader = upRes.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (e) {
    try {
      res.write(`data: ${JSON.stringify({ error: `Could not reach tunnel: ${e && e.message ? e.message : e}` })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } catch {}
  }
}

function endJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}
const ALLOWED_ORIGINS = [
  'https://runonaspen.com',
  'https://www.runonaspen.com',
  'capacitor://localhost',
  'ionic://localhost',
  'http://localhost',
  'https://localhost',
];
function setCors(res, origin) {
  const allow = (ALLOWED_ORIGINS.includes(origin) || (origin && origin.endsWith('.runonaspen.com')))
    ? origin : 'https://runonaspen.com';
  res.setHeader('Access-Control-Allow-Origin', allow);
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
  res.setHeader('X-Aspen-Proxy', 'proxy-node-v1');
}
