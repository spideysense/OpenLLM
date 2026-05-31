/**
 * /api/search — Web search using DuckDuckGo HTML scraping
 * No API key. No limits. Always works.
 */
export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  if (req.method !== 'POST') return new Response('POST only', { status: 405, headers: cors() });

  let body;
  try { body = await req.json(); } catch { return err('Invalid JSON', 400); }

  const { query } = body;
  if (!query || typeof query !== 'string') return err('query required', 400);

  const results = await searchDDG(query.slice(0, 200));

  return new Response(JSON.stringify({ results, query }), {
    status: 200,
    headers: { ...cors(), 'Content-Type': 'application/json' },
  });
}

async function searchDDG(query) {
  try {
    // DuckDuckGo HTML search — no key, no limits
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=us-en`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!res.ok) return [];
    const html = await res.text();

    const results = [];

    // Extract result snippets — DDG HTML format
    // Results are in <div class="result"> blocks
    const resultBlocks = html.split('<div class="result ');
    
    for (const block of resultBlocks.slice(1, 8)) {
      // Title: inside <a class="result__a"
      const titleMatch = block.match(/class="result__a"[^>]*>([^<]+)</);
      // URL: in href of result__a
      const urlMatch = block.match(/class="result__url"[^>]*>([^<]+)</);
      // Snippet: in result__snippet
      const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);

      const title = titleMatch ? titleMatch[1].trim() : '';
      const url = urlMatch ? urlMatch[1].trim() : '';
      const snippet = snippetMatch
        ? snippetMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
        : '';

      if (snippet || title) {
        results.push({ title, url, snippet });
      }
    }

    return results.slice(0, 6);
  } catch (e) {
    console.error('DDG search error:', e.message);
    return [];
  }
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
