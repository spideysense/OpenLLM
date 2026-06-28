// The self-improvement engine: a multi-armed bandit over growth TACTICS.
// Each tactic tracks how many downloads it produced per attempt. The strategist
// allocates the next actions toward tactics with the best score, while still
// exploring under-tried ones (UCB1). When a human reports the result of a
// shipped action, recordOutcome() updates the tactic — so the agent literally
// gets better at picking what works, instead of just doing more.
import { load, save } from './store.js';
import { CHANNELS } from './config.js';

const seed = () => CHANNELS.map((c) => ({
  id: c.id, name: c.name, kind: c.kind, fit: c.fit,
  attempts: 0, downloads: 0, score: c.fit * 5, // prior: fit-weighted EV downloads/attempt
}));

export function getPlaybook() {
  let p = load('playbook', null);
  if (!p) p = save('playbook', seed());
  return p;
}

// UCB1 ranking: exploit high scorers, explore the under-sampled.
export function rankTactics() {
  const p = getPlaybook();
  const totalN = p.reduce((n, t) => n + t.attempts, 0) + 1;
  return [...p]
    .map((t) => {
      const mean = t.attempts ? t.downloads / t.attempts : t.score;
      const explore = Math.sqrt((2 * Math.log(totalN)) / (t.attempts + 1));
      return { ...t, ucb: mean + explore * (t.fit + 0.5) };
    })
    .sort((a, b) => b.ucb - a.ucb);
}

// Called when a human marks a shipped action's result.
export function recordOutcome(tacticId, downloads) {
  const p = getPlaybook();
  const t = p.find((x) => x.id === tacticId);
  if (!t) return null;
  t.attempts += 1;
  t.downloads += Math.max(0, Number(downloads) || 0);
  t.score = t.downloads / t.attempts; // running EV downloads per attempt
  save('playbook', p);
  return t;
}
