export const config = { runtime: 'edge' };

export default async function handler(req) {
  const url = new URL(req.url);
  const query = url.searchParams.get('q') || 'news today';

  const res = await fetch(`https://search.brave.com/search?q=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
  });
  const html = await res.text();

  const idx = html.indexOf('data-type="web"');
  // Grab a full result block — from data-type=web to the next one
  const next = html.indexOf('data-type="web"', idx + 10);
  const block = html.slice(idx, next > -1 ? next : idx + 3000);

  // Look for title and description classes
  const out = {
    query,
    titleClasses: (block.match(/class="[^"]*title[^"]*"/gi) || []).slice(0, 5),
    descMatch: (block.match(/class="[^"]*(snippet-description|desc|snippet-content)[^"]*"/gi) || []).slice(0, 5),
    // Show second half of block (where title/desc usually are)
    blockSecondHalf: block.slice(1000, 2800),
  };

  return new Response(JSON.stringify(out, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
