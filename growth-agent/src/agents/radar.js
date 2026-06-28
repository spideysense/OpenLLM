// Intent radar: pull recent community posts, have the model score buying-intent
// and draft a GENUINE, helpful reply that mentions Aspen only where it honestly
// fits. Output is queued for a human to post (automated posting = bans).
import { askJSON } from '../aspen.js';
import { PRODUCT } from '../config.js';
import { redditIntent } from '../collectors/reddit.js';
import { hnIntent } from '../collectors/hackernews.js';
import { propose } from '../proposals.js';
import { push, load, save } from '../store.js';
import { log } from '../log.js';

const SYS = `You are a growth analyst for Aspen. ${PRODUCT}

You are given community posts. For each, judge whether the author is a genuine BUYER for Aspen (wants private/local/offline AI AND plausibly has a capable Mac). Score intent 0-100. Only HIGH-intent posts (>=70) are worth a reply.

For high-intent posts, write a SHORT, genuinely helpful reply in the author's context. Rules:
- Be useful first; recommend Aspen only if it truly fits. If a non-Aspen answer is better, say so (honesty wins on these forums and avoids bans).
- No marketing voice, no emoji-spam, no copy-paste pitch. Sound like a knowledgeable person.
- Disclose it's your project ("I built X" / "disclosure: I work on this") — these communities punish stealth promotion.
- If the iOS app comes up, be upfront that it's a companion to the free Mac app.
Return JSON: {"items":[{"id","intent","reason","worth_reply":bool,"draft_reply"}]}`;

export async function runRadar() {
  const seen = new Set(load('radar_seen', []));
  const posts = [...await redditIntent(), ...await hnIntent()].filter((p) => !seen.has(p.id)).slice(0, 40);
  if (!posts.length) { log('radar: no new posts'); return []; }

  const scored = await askJSON(SYS, JSON.stringify(posts.map((p) => ({ id: p.id, title: p.title, text: p.text, sub: p.sub || p.source }))));
  const byId = Object.fromEntries(posts.map((p) => [p.id, p]));
  const winners = (scored.items || []).filter((i) => i.worth_reply && i.intent >= 70);

  for (const w of winners) {
    const p = byId[w.id]; if (!p) continue;
    propose({
      tactic: p.sub ? `reddit_${(p.sub || '').toLowerCase()}` : 'hackernews',
      title: `Reply to: ${p.title?.slice(0, 80)}`,
      estImpact: Math.round(w.intent / 20),
      body: `${p.url}\n\nintent ${w.intent} — ${w.reason}\n\nDRAFT REPLY (you post it):\n${w.draft_reply}`,
      meta: { url: p.url, postId: p.id },
    });
  }
  save('radar_seen', [...seen, ...posts.map((p) => p.id)].slice(-2000));
  push('radar_runs', { scanned: posts.length, queued: winners.length });
  log(`radar: scanned ${posts.length}, queued ${winners.length} replies`);
  return winners;
}
