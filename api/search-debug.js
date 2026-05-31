/**
 * /api/search-debug?q=... — tests multiple free search sources from Vercel's IP
 */
export const config = { runtime: 'edge' };

export default async function handler(req) {
  const url = new URL(req.url);
  const query = url.searchParams.get('q') || 'news today';
  const debug = { query, steps: [] };

  // 1. Wikipedia API (always allows servers, free, no key)
  try {
    const res = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=3`,
      { headers: { 'User-Agent': 'Aspen/1.0 (runonaspen.com)' } }
    );
    const text = await res.text();
    debug.steps.push({ step: 'Wikipedia API', status: res.status, len: text.length, preview: text.slice(0, 200) });
  } catch (e) { debug.steps.push({ step: 'Wikipedia API', error: e.message }); }

  // 2. Brave Search via lite HTML (search.brave.com)
  try {
    const res = await fetch(`https://search.brave.com/search?q=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
    });
    const text = await res.text();
    debug.steps.push({ step: 'Brave HTML', status: res.status, len: text.length, hasResults: text.includes('snippet') });
  } catch (e) { debug.steps.push({ step: 'Brave HTML', error: e.message }); }

  // 3. Bing HTML scraping
  try {
    const res = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
    });
    const text = await res.text();
    debug.steps.push({ step: 'Bing HTML', status: res.status, len: text.length, hasResults: text.includes('<li class="b_algo"') });
  } catch (e) { debug.steps.push({ step: 'Bing HTML', error: e.message }); }

  // 4. DuckDuckGo Lite (different endpoint than html)
  try {
    const res = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `q=${encodeURIComponent(query)}`,
    });
    const text = await res.text();
    debug.steps.push({ step: 'DDG Lite', status: res.status, len: text.length, hasResults: text.includes('result-link') });
  } catch (e) { debug.steps.push({ step: 'DDG Lite', error: e.message }); }

  // 5. Google News RSS (free, no key, servers allowed)
  try {
    const res = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const text = await res.text();
    debug.steps.push({ step: 'Google News RSS', status: res.status, len: text.length, itemCount: (text.match(/<item>/g) || []).length });
  } catch (e) { debug.steps.push({ step: 'Google News RSS', error: e.message }); }

  return new Response(JSON.stringify(debug, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
