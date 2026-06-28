#!/usr/bin/env node
// Run any growth function once, without Inngest. Great for the box cron or testing.
//   node src/cli.js pulse|radar|aso|strategy|queue|outcome <tactic> <downloads>
import { runPulse } from './agents/pulse.js';
import { runRadar } from './agents/radar.js';
import { runASO } from './agents/aso.js';
import { runStrategist } from './agents/strategist.js';
import { runHealth } from './agents/health.js';
import { runUpgrades } from './agents/upgrades.js';
import { pending } from './proposals.js';
import { recordOutcome, rankTactics } from './playbook.js';

const [cmd, ...args] = process.argv.slice(2);
const cmds = {
  pulse: runPulse,
  radar: runRadar,
  aso: runASO,
  strategy: runStrategist,
  health: runHealth,
  upgrades: runUpgrades,
  queue: async () => { const p = pending(); console.log(`${p.length} pending:\n` + p.map((x) => `• [${x.tactic}] ${x.title}  (${x._id})`).join('\n')); return p; },
  rank: async () => rankTactics().map((t) => `${t.id}\t${t.score.toFixed(1)} dl/attempt\t(${t.attempts} tries)`).join('\n'),
  outcome: async () => recordOutcome(args[0], Number(args[1])),
};
if (!cmds[cmd]) { console.log('usage: node src/cli.js [pulse|radar|aso|strategy|health|upgrades|queue|rank|outcome <tactic> <downloads>]'); process.exit(1); }
cmds[cmd]().then((r) => { if (r && typeof r !== 'string') console.log(JSON.stringify(r, null, 2)); else if (r) console.log(r); process.exit(0); })
  .catch((e) => { console.error(e); process.exit(1); });
