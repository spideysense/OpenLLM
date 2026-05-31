/**
 * /api/search — Web search, no API key required
 * 
 * Strategy: try DDG instant answers first (great for stocks, facts, weather).
 * Then DDG HTML scraping for general queries (news, current events, anything).
 */
export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  if (req.method !== 'POST') return new Response('POST only', { status: 405, headers: cors() });

  let body;
  try { body = await req.json(); } catch { return err('Invalid JSON', 400); }

  const { query } = body;
  if (!query || typeof query !== 'string') return err('query required', 400);

  const q = query.slice(0, 200);
  let results = [];

  // 1. DDG Instant Answer API — works great for stocks, facts, definitions
  try {
    const res = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (res.ok) {
      const data = await res.json();
      if (data.AbstractText) results.push({ title: data.Heading || q, url: data.AbstractURL || '', snippet: data.AbstractText });
      if (data.Answer) results.push({ title: 'Answer', url: '', snippet: data.Answer });
      for (const t of (data.RelatedTopics || []).slice(0, 3)) {
        if (t.Text && t.FirstURL) results.push({ title: t.Text.split(' - ')[0] || '', url: t.FirstURL, snippet: t.Text });
      }
    }
  } catch {}

  // 2. DDG HTML scraping — works for news, current events, general queries
  try {
    const res = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}&kl=us-en`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      }
    );
    if (res.ok) {
      const html = await res.text();
      // Parse result blocks
      const blocks = html.split('result__body');
      for (const block of blocks.slice(1, 7)) {
        const titleM = block.match(/result__a[^>]*>([^<]+)<\/a>/);
        const snippetM = block.match(/result__snippet[^>]*>([\s\S]*?)<\/a>/);
        const urlM = block.match(/result__url[^>]*>([^<]+)<\/span>/);
        const title = titleM ? titleM[1].replace(/&#x27;/g, "'").trim() : '';
        const snippet = snippetM ? snippetM[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
        const url = urlM ? urlM[1].trim() : '';
        if (snippet.length > 20) results.push({ title, url, snippet });
      }
    }
  } catch {}

  return new Response(
    JSON.stringify({ results: results.slice(0, 6), query: q }),
    { status: 200, headers: { ...cors(), 'Content-Type': 'application/json' } }
  );
}

function err(msg, status) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { ...cors(), 'Content-Type': 'application/json' } });
}
function cors() {
  return {
    'Access-Control-Allow-Origin': 'https://runonaspen.com',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
