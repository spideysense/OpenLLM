// The approval queue. Every action the agent wants to take that touches the
// outside world becomes a proposal a human approves with one tap. Nothing
// auto-publishes to a third-party platform.
import { load, save, push } from './store.js';
import { cfg } from './config.js';
import { log } from './log.js';

export function propose(p) {
  const item = push('proposals', { status: 'pending', ...p });
  notifySlack(item).catch(() => {});
  return item;
}
export function pending() { return load('proposals', []).filter((p) => p.status === 'pending'); }
export function setStatus(id, status, extra = {}) {
  const all = load('proposals', []);
  const p = all.find((x) => x._id === id);
  if (p) { Object.assign(p, { status, ...extra, _updated: new Date().toISOString() }); save('proposals', all); }
  return p;
}

async function notifySlack(p) {
  if (!cfg.slackWebhook) { log(`PROPOSAL [${p.tactic}] ${p.title}`); return; }
  const body = {
    text: `*New growth proposal — ${p.title}*`,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `*${p.title}*\n_${p.tactic} · est. impact ${p.estImpact || '?'} dl_\n\n${(p.body || '').slice(0, 1200)}` } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: `id: ${p._id} · approve in the queue, then you do the publish click` }] },
    ],
  };
  await fetch(cfg.slackWebhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
