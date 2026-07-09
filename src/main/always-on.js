// always-on.js — persistent background "missions". Give Aspen a long-running goal
// ("decipher the Voynich manuscript", "keep improving this code") and it works on
// it continuously in the background: one incremental step at a time, journaling
// progress, resuming across restarts. It won't magically solve hard open problems,
// but it genuinely keeps at it and records what it tried and found.
//
// Runs entirely on the user's machine. Rate-limited (one step at a time, spaced
// out) so it never hammers the box or the model.

const store = require('./store');

const KEY = 'missions';
const MIN_INTERVAL_MS = 3 * 60 * 1000;   // ≥3 min between a mission's steps
const TICK_MS = 60 * 1000;               // scheduler checks every minute
const MAX_JOURNAL = 200;                 // keep the last N step entries
const DEFAULT_MAX_STEPS = 1000;          // safety ceiling per mission

let _deps = null;      // { runAgent, getActiveModel }
let _timer = null;
let _busy = false;     // one step at a time across all missions

function load() { try { return store.get(KEY) || []; } catch { return []; } }
function persist(m) { try { store.set(KEY, m); } catch {} }

function init(deps) {
  _deps = deps;
  purgeBogus();
  if (load().some((m) => m.status === 'active')) ensureScheduler();
}

// Remove the junk missions the old recursion bug created (their goal is the
// engine's own step prompt). Also collapses accidental duplicates of a goal.
const BOGUS_RX = /^\s*You are working autonomously/i;
function purgeBogus() {
  const m = load();
  const clean = m.filter((x) => !BOGUS_RX.test(String(x.goal || '')));
  if (clean.length !== m.length) persist(clean);
}

function ensureScheduler() {
  if (_timer || !_deps) return;
  _timer = setInterval(() => { tick().catch(() => {}); }, TICK_MS);
  if (_timer.unref) _timer.unref();
}

function start(goal, { maxSteps = DEFAULT_MAX_STEPS, intervalMs = MIN_INTERVAL_MS } = {}) {
  const g = String(goal || '').trim();
  if (!g) return { error: 'A mission needs a goal.' };
  if (BOGUS_RX.test(g)) return { error: 'Invalid mission goal.' };
  const missions = load();
  const active = missions.filter((m) => m.status === 'active').length;
  if (active >= 3) return { error: 'Already running 3 missions. Stop one first.' };
  const id = 'm' + Date.now().toString(36);
  missions.push({
    id, goal: g, status: 'active', steps: 0,
    maxSteps: Math.min(Math.max(1, maxSteps), 100000),
    intervalMs: Math.max(60 * 1000, intervalMs),
    created: Date.now(), lastStep: 0, journal: [],
  });
  persist(missions);
  ensureScheduler();
  return { id, goal: g };
}

function stop(id) {
  const m = load();
  const x = m.find((z) => z.id === id);
  if (x) { x.status = 'stopped'; persist(m); }
  return { stopped: !!x };
}

function stopAll() {
  const m = load();
  m.forEach((x) => { if (x.status === 'active') x.status = 'stopped'; });
  persist(m);
  return { stopped: true };
}

// A compact view for the model / UI (drops the full journal, keeps a tail).
function status() {
  return load().map((m) => ({
    id: m.id, goal: m.goal, status: m.status, steps: m.steps,
    lastStep: m.lastStep ? new Date(m.lastStep).toISOString() : null,
    latest: (m.journal || []).slice(-2),
  }));
}

function buildPrompt(mission) {
  const recent = (mission.journal || []).slice(-6).join('\n\n---\n\n');
  return (
    `You are working autonomously and continuously on a long-running mission. This is step ${mission.steps + 1}.\n\n` +
    `MISSION: ${mission.goal}\n\n` +
    `Your progress so far (most recent last):\n${recent || '(nothing yet — this is the very first step)'}\n\n` +
    `Make ONE concrete increment of progress right now. Use tools as needed (web_search to gather evidence, run_command to write and run code/analysis, etc.). Build on the prior steps — do NOT repeat what's already been tried. ` +
    `Then end with a short journal entry: what you tried this step, what you found, and the single most promising next step.\n\n` +
    `If the mission is genuinely finished, begin your reply with "MISSION COMPLETE:". If it's truly impossible or you're certain you cannot make further progress, begin with "MISSION BLOCKED:". Otherwise just keep making progress.`
  );
}

async function runStep(mission) {
  const model = _deps.getActiveModel();
  const messages = [{ role: 'user', content: buildPrompt(mission) }];
  let out = '';
  for await (const ev of _deps.runAgent({ model, messages, isOwner: true, background: true })) {
    if (ev.type === 'content') out += ev.text;
  }
  return out.trim() || '(no output this step)';
}

async function tick() {
  if (_busy || !_deps) return;
  const missions = load();
  const now = Date.now();
  const due = missions.find(
    (m) => m.status === 'active' && m.steps < m.maxSteps && (now - (m.lastStep || 0)) >= (m.intervalMs || MIN_INTERVAL_MS)
  );
  if (!due) return;

  _busy = true;
  try {
    let result;
    try { result = await runStep(due); }
    catch (e) { result = 'Step error: ' + (e && e.message ? e.message : String(e)); }

    // Re-load in case something changed while the step ran, then update THIS mission.
    const fresh = load();
    const m = fresh.find((z) => z.id === due.id);
    if (m) {
      m.steps += 1;
      m.lastStep = Date.now();
      m.journal = [...(m.journal || []), result].slice(-MAX_JOURNAL);
      if (/^\s*MISSION COMPLETE:/i.test(result)) m.status = 'done';
      else if (/^\s*MISSION BLOCKED:/i.test(result)) m.status = 'blocked';
      else if (m.steps >= m.maxSteps) m.status = 'done';
      persist(fresh);
    }
  } finally {
    _busy = false;
  }
}

module.exports = { init, start, stop, stopAll, status, load, buildPrompt, tick };
