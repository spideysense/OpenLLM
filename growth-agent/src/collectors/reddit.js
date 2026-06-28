// Buying-intent radar over public Reddit JSON (no auth for read/search).
import { cfg } from '../config.js';
const SUBS = ['LocalLLaMA', 'selfhosted', 'macapps', 'privacy', 'ollama'];
const QUERIES = ['private AI', 'local AI app', 'offline AI', 'run LLM locally', 'ChatGPT alternative private', 'local AI iphone'];

export async function redditIntent({ perQuery = 6 } = {}) {
  const out = [];
  for (const sub of SUBS) {
    for (const q of QUERIES) {
      try {
        const u = `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(q)}&restrict_sr=1&sort=new&t=week&limit=${perQuery}`;
        const r = await fetch(u, { headers: { 'User-Agent': cfg.userAgent } });
        if (!r.ok) continue;
        const j = await r.json();
        for (const c of j.data?.children || []) {
          const d = c.data;
          out.push({ source: 'reddit', sub, id: d.id, title: d.title,
            text: (d.selftext || '').slice(0, 600), url: `https://reddit.com${d.permalink}`,
            score: d.score, comments: d.num_comments, created: d.created_utc,
            age_h: Math.round((Date.now() / 1000 - d.created_utc) / 3600) });
        }
      } catch { /* skip */ }
    }
  }
  return Object.values(Object.fromEntries(out.map((o) => [o.id, o])));
}
