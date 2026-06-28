// Cron schedule. Heavy LLM jobs run off-peak so they don't compete with real
// users on the box. Every function is also runnable on demand via the CLI.
import { inngest } from './client.js';
import { runPulse } from '../agents/pulse.js';
import { runRadar } from '../agents/radar.js';
import { runASO } from '../agents/aso.js';
import { runStrategist } from '../agents/strategist.js';
import { runHealth } from '../agents/health.js';
import { runUpgrades } from '../agents/upgrades.js';
import { recordOutcome } from '../playbook.js';

export const pulse = inngest.createFunction(
  { id: 'daily-pulse' }, { cron: '0 13 * * *' }, async () => runPulse());

export const radar = inngest.createFunction(
  { id: 'intent-radar' }, { cron: '0 8,20 * * *' }, async () => runRadar());

export const aso = inngest.createFunction(
  { id: 'aso-weekly' }, { cron: '0 14 * * 1' }, async () => runASO());

export const strategy = inngest.createFunction(
  { id: 'weekly-strategist' }, { cron: '0 15 * * 1' }, async () => runStrategist());

export const health = inngest.createFunction(
  { id: 'ops-health' }, { cron: '0 * * * *' }, async () => runHealth());

export const upgrades = inngest.createFunction(
  { id: 'ops-upgrades' }, { cron: '0 16 * * 1' }, async () => runUpgrades());

// Event: human reports the result of a shipped action -> the playbook learns.
export const outcome = inngest.createFunction(
  { id: 'record-outcome' }, { event: 'growth/outcome.reported' },
  async ({ event }) => recordOutcome(event.data.tactic, event.data.downloads));

export const functions = [pulse, radar, aso, strategy, health, upgrades, outcome];
