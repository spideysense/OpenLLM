export const config = { runtime: 'edge' };

export default async function handler(req) {
  const url = new URL(req.url);
  const query = url.searchParams.get('q') || 'news today';

  const res = await fetch(`https://search.brave.com/search?q=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
  });
  const html = await res.text();

  // Find the structure around snippets
  const out = { query, status: res.status, len: html.length, samples: [] };

  // Look for common Brave result patterns
  const patterns = {
    'data-type=web': (html.match(/data-type="web"/g) || []).length,
    'class snippet': (html.match(/class="snippet/g) || []).length,
    'snippet-content': (html.match(/snippet-content/g) || []).length,
    'result-header': (html.match(/result-header/g) || []).length,
    '<a href href count': (html.match(/<a href="https?:\/\//g) || []).length,
  };
  out.patterns = patterns;

  // Grab a chunk around the first "snippet" occurrence
  const idx = html.indexOf('snippet');
  if (idx > -1) out.aroundSnippet = html.slice(idx - 200, idx + 600);

  return new Response(JSON.stringify(out, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
