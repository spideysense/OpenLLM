// Scans for things worth pulling in: new upstream commits (features/fixes) and
// model freshness. Summarizes via the box model and files a proposal — a human
// pulls, tests, and releases. Never auto-applies to the running box.
import { askJSON } from '../aspen.js';
import { cfg, PRODUCT } from '../config.js';
import { ollamaState } from '../collectors/ollama.js';
import { propose } from '../proposals.js';
import { push } from '../store.js';
import { log } from '../log.js';

async function recentCommits() {
  const h = { 'User-Agent': cfg.userAgent, Accept: 'application/vnd.github+json' };
  if (cfg.githubToken) h.Authorization = `Bearer ${cfg.githubToken}`;
  const since = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
  try {
    const r = await fetch(`https://api.github.com/repos/${cfg.githubRepo}/commits?since=${since}&per_page=40`, { headers: h });
    const j = await r.json();
    return (Array.isArray(j) ? j : []).map((c) => ({ sha: c.sha?.slice(0, 7), msg: c.commit?.message?.split('\n')[0] }));
  } catch { return []; }
}

const SYS = `You maintain Aspen. ${PRODUCT}
Given last week's commits and the box's installed/recommended models, produce a short maintenance digest: which commits look like user-facing features/fixes worth pulling + testing, any model that should be added/updated, and any risk to watch. Be concrete and conservative.
Return JSON: {"pull_and_test":[{"sha","why"}],"model_actions":[{"action","model","why"}],"watch":["..."]}`;

export async function runUpgrades() {
  const commits = await recentCommits();
  const st = await ollamaState();
  const missing = cfg.ops.recommendedModels.filter((m) => st.reachable && !st.installed.includes(m));
  const digest = await askJSON(SYS, JSON.stringify({ commits, installed: st.installed, recommended: cfg.ops.recommendedModels, missing }));

  const body = [
    digest.pull_and_test?.length ? `PULL & TEST:\n${digest.pull_and_test.map((p) => `- ${p.sha}: ${p.why}`).join('\n')}` : '',
    digest.model_actions?.length ? `MODELS:\n${digest.model_actions.map((m) => `- ${m.action} ${m.model} — ${m.why}`).join('\n')}` : '',
    missing.length ? `MISSING RECOMMENDED MODELS: ${missing.join(', ')} (ollama pull <model>)` : '',
    digest.watch?.length ? `WATCH: ${digest.watch.join('; ')}` : '',
  ].filter(Boolean).join('\n\n');

  if (body) propose({ tactic: 'ops_upgrades', title: 'Weekly maintenance digest', estImpact: 0, body, meta: { digest, missing } });
  push('upgrade_runs', { commits: commits.length, missing });
  log(`upgrades: ${commits.length} commits scanned, ${missing.length} missing models`);
  return { digest, missing };
}
