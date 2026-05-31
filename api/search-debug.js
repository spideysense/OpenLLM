export const config = { runtime: 'edge' };

export default async function handler(req) {
  const url = new URL(req.url);
  const query = url.searchParams.get('q') || 'news today';

  const res = await fetch(`https://search.brave.com/search?q=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
  });
  const html = await res.text();

  const out = { query, status: res.status };

  // Grab chunk around first data-type="web" — actual result markup
  const idx = html.indexOf('data-type="web"');
  if (idx > -1) out.aroundWebResult = html.slice(idx, idx + 1400);

  return new Response(JSON.stringify(out, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
