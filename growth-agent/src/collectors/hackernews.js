// HN buying-intent + competitor mentions via Algolia (public, no key).
import { cfg } from '../config.js';
export async function hnIntent() {
  const qs = ['local LLM', 'private AI', 'run AI locally', 'offline AI assistant', 'ollama'];
  const out = [];
  for (const q of qs) {
    try {
      const since = Math.floor(Date.now() / 1000) - 7 * 86400;
      const r = await fetch(`https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(q)}&tags=(story,comment)&numericFilters=created_at_i>${since}`,
        { headers: { 'User-Agent': cfg.userAgent } });
      const j = await r.json();
      for (const h of j.hits || []) {
        out.push({ source: 'hn', id: h.objectID, title: h.title || h.story_title,
          text: (h.comment_text || h.story_text || '').replace(/<[^>]+>/g, '').slice(0, 600),
          url: `https://news.ycombinator.com/item?id=${h.objectID}`, points: h.points, created: h.created_at_i });
      }
    } catch { /* skip */ }
  }
  return Object.values(Object.fromEntries(out.map((o) => [o.id, o])));
}
