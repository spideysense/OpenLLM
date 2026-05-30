export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
  if (req.method !== 'POST') return new Response('POST only', { status: 405, headers: corsHeaders() });

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } }); }

  const { query } = body;
  if (!query || typeof query !== 'string' || query.length > 500) return new Response(JSON.stringify({ error: 'query required' }), { status: 400, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } });

  const SERPER_KEY = process.env.SERPER_API_KEY;
  let results = [], source = 'none';

  if (SERPER_KEY) {
    try {
      const res = await fetch('https://google.serper.dev/search', { method: 'POST', headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ q: query, num: 5 }) });
      if (res.ok) {
        const data = await res.json();
        if (data.answerBox?.answer) results.push({ title: 'Direct answer', url: '', snippet: data.answerBox.answer });
        else if (data.answerBox?.snippet) results.push({ title: data.answerBox.title || '', url: data.answerBox.link || '', snippet: data.answerBox.snippet });
        if (data.knowledgeGraph?.description) results.push({ title: data.knowledgeGraph.title || '', url: data.knowledgeGraph.website || '', snippet: data.knowledgeGraph.description });
        for (const r of (data.organic || []).slice(0, 5)) results.push({ title: r.title || '', url: r.link || '', snippet: r.snippet || '' });
        source = 'serper';
      }
    } catch {}
  }

  if (results.length === 0) {
    try {
      const res = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`, { headers: { 'User-Agent': 'Aspen/1.0' } });
      if (res.ok) {
        const data = await res.json();
        if (data.AbstractText) results.push({ title: data.Heading || query, url: data.AbstractURL || '', snippet: data.AbstractText });
        for (const t of (data.RelatedTopics || []).slice(0, 4)) { if (t.Text && t.FirstURL) results.push({ title: t.Text.split(' - ')[0], url: t.FirstURL, snippet: t.Text }); }
        source = 'ddg';
      }
    } catch {}
  }

  return new Response(JSON.stringify({ results: results.slice(0, 6), source, query }), { status: 200, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } });
}

function corsHeaders() { return { 'Access-Control-Allow-Origin': 'https://runonaspen.com', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }; }
