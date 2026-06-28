// The brain. Reads every snapshot + the tactic playbook + the goal, reflects on
// what's moving, and produces THE prioritized plan — weighted by which tactics
// have actually driven installs (self-improvement via the bandit playbook).
import { askJSON } from '../aspen.js';
import { PRODUCT, cfg } from '../config.js';
import { rankTactics } from '../playbook.js';
import { load, push } from '../store.js';
import { propose } from '../proposals.js';
import { log } from '../log.js';

const SYS = `You are the head of growth for Aspen. Goal: ${'${goal}'} net new downloads/day (App Store + web), sustainably, without spammy tactics that risk bans or Google penalties. ${PRODUCT}

You get: recent metric snapshots, the tactic playbook (each tactic's measured downloads-per-attempt so far), and the ranked tactic list. Decide the 3 highest-leverage actions for THIS week and what to stop. Be specific and realistic — name the subreddit/post angle/listing change, not "do marketing".
Return JSON: {"diagnosis":"where downloads stand vs goal","top_actions":[{"tactic","action","why","expected_downloads"}],"stop_doing":["..."],"experiment":"one cheap test to learn something new"}`;

export async function runStrategist() {
  const metrics = (load('metrics', []) || []).slice(-14);
  const ranked = rankTactics();
  const plan = await askJSON(
    SYS.replace('${goal}', cfg.goalPerDay),
    JSON.stringify({ recent_metrics: metrics, playbook: ranked.map((t) => ({ tactic: t.id, downloads_per_attempt: +t.score.toFixed(1), attempts: t.attempts })), ranked: ranked.map((t) => t.id) }),
  );
  propose({
    tactic: 'strategy', title: `Weekly growth plan (goal ${cfg.goalPerDay}/day)`, estImpact: cfg.goalPerDay,
    body: `DIAGNOSIS: ${plan.diagnosis}\n\nTOP ACTIONS:\n${(plan.top_actions || []).map((a, i) => `${i + 1}. [${a.tactic}] ${a.action}\n   why: ${a.why} · ~${a.expected_downloads} dl`).join('\n')}\n\nSTOP: ${(plan.stop_doing || []).join('; ')}\n\nEXPERIMENT: ${plan.experiment}`,
    meta: plan,
  });
  push('plans', plan);
  log('strategist: weekly plan queued');
  return plan;
}
