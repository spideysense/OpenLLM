/**
 * /api/search-debug — visit this in your browser to see EXACTLY what search returns
 * https://runonaspen.com/api/search-debug?q=news+today
 */
export const config = { runtime: 'edge' };

export default async function handler(req) {
  const url = new URL(req.url);
  const query = url.searchParams.get('q') || 'news today';
  const debug = { query, steps: [] };

  // Step 1: DDG Instant Answer
  try {
    const res = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    const text = await res.text();
    debug.steps.push({
      step: 'DDG Instant Answer API',
      status: res.status,
      ok: res.ok,
      bodyLength: text.length,
      bodyPreview: text.slice(0, 300),
    });
  } catch (e) {
    debug.steps.push({ step: 'DDG Instant Answer API', error: e.message });
  }

  // Step 2: DDG HTML scraping
  try {
    const res = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=us-en`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      }
    );
    const html = await res.text();
    const blockCount = html.split('result__body').length - 1;
    const snippetCount = (html.match(/result__snippet/g) || []).length;
    debug.steps.push({
      step: 'DDG HTML scraping',
      status: res.status,
      ok: res.ok,
      htmlLength: html.length,
      resultBlocks: blockCount,
      snippetMatches: snippetCount,
      htmlPreview: html.slice(0, 500),
    });
  } catch (e) {
    debug.steps.push({ step: 'DDG HTML scraping', error: e.message });
  }

  return new Response(JSON.stringify(debug, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
