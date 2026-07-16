// always-on.js — persistent background "missions". Give Aspen a long-running goal
// ("decipher the Voynich manuscript", "keep improving this code") and it works on
// it continuously in the background: one incremental step at a time, journaling
// progress, resuming across restarts. It won't magically solve hard open problems,
// but it genuinely keeps at it and records what it tried and found.
//
// Runs entirely on the user's machine. Rate-limited (one step at a time, spaced
// out) so it never hammers the box or the model.

const store = require('./store');
const foreground = require('./foreground');

const KEY = 'missions';
const TICK_MS = 2 * 1000;                // heartbeat: how soon we pick work back up
const MAX_JOURNAL = 200;                 // keep the last N step entries
const DEFAULT_MAX_STEPS = 1000;          // safety ceiling per mission

let _deps = null;      // { runAgent, getActiveModel }
let _timer = null;
let _busy = false;     // one step at a time across all missions
let _runningId = null; // which mission is executing a step RIGHT NOW
const _stopRequested = new Set(); // mission ids asked to stop mid-step

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

function start(goal, { maxSteps = DEFAULT_MAX_STEPS, intervalMs = 0 } = {}) {
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
    intervalMs: Math.max(0, intervalMs || 0),
    created: Date.now(), lastStep: 0, journal: [],
  });
  persist(missions);
  ensureScheduler();
  return { id, goal: g };
}

function stop(id) {
  const m = load();
  const x = m.find((z) => z.id === id);
  if (x) { x.status = 'stopped'; persist(m); _stopRequested.add(id); }
  return { stopped: !!x };
}

function stopAll() {
  const m = load();
  m.forEach((x) => { if (x.status === 'active') { x.status = 'stopped'; _stopRequested.add(x.id); } });
  persist(m);
  return { stopped: true };
}

// Let the user steer a running (or stopped) mission. The guidance is added to the
// journal so the next step reads and follows it. A stopped mission is re-activated
// so the guidance actually gets acted on.
function guide(id, text) {
  const t = String(text || '').trim();
  if (!t) return { ok: false };
  const m = load();
  const x = m.find((z) => z.id === id);
  if (!x) return { ok: false };

  // Typing "stop" at a mission means STOP. It used to be filed as a note for the
  // model to maybe read at its next step (up to minutes away) — which reads as
  // the app ignoring you.
  if (/^(stop|pause|halt|cancel|abort|quit|stop it|stop this|please stop)[.!]*$/i.test(t)) {
    x.status = 'stopped';
    _stopRequested.add(id);
    x.journal = [...(x.journal || []), '[USER] Stopped this mission.'].slice(-MAX_JOURNAL);
    persist(m);
    return { ok: true, status: 'stopped', stopped: true };
  }

  x.journal = [...(x.journal || []), `[USER GUIDANCE] ${t}`].slice(-MAX_JOURNAL);

  // Only resume a stopped mission if you actually asked it to resume. Silently
  // restarting because you typed at it is the opposite of what you meant.
  const wantsResume = /\b(resume|continue|restart|keep going|carry on|go on|start again)\b/i.test(t);
  if (x.status === 'stopped' && wantsResume) {
    x.status = 'active';
    _stopRequested.delete(id);
  }
  persist(m);
  try { ensureScheduler(); } catch {}
  return { ok: true, status: x.status, queued: x.status === 'stopped' };
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
  for await (const ev of _deps.runAgent({
    model, messages, isOwner: true, background: true,
    shouldAbort: () => _stopRequested.has(mission.id),
    shouldPause: () => foreground.isBusy(),
  })) {
    // Stop promptly if the user hit "stop" mid-step — don't keep running tools.
    if (_stopRequested.has(mission.id)) return '__ABORTED__';
    if (ev.type === 'content') out += ev.text;
  }
  return out.trim() || '(no output this step)';
}

async function tick() {
  if (_busy || !_deps) return;
  // Don't even start a step while the person is using Aspen — it would compete
  // for the GPU. A later tick picks it up as soon as they're idle.
  if (foreground.isBusy()) return;
  const missions = load();
  // Due = active and not finished. No clock gate: if there's work and nobody
  // needs the machine, do it now.
  const due = missions.find((m) => m.status === 'active' && m.steps < m.maxSteps);
  if (!due) return;

  _busy = true;
  _runningId = due.id;
  try {
    let result;
    try { result = await runStep(due); }
    catch (e) { result = 'Step error: ' + (e && e.message ? e.message : String(e)); }

    // Aborted mid-step by a stop — clear the flag and don't journal/advance.
    if (result === '__ABORTED__') { _stopRequested.delete(due.id); return; }

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
    _runningId = null;
  }

  // Did a step and the machine is still ours -> go straight into the next one.
  // Back to back, no delay. If you send a chat, the check at the top of tick()
  // (and the round-boundary pause inside the agent) stops it immediately, and the
  // heartbeat resumes it once you've been idle for the grace window.
  setImmediate(() => { tick().catch(() => {}); });
}

/**
 * Missions + what each one is doing RIGHT NOW.
 *
 * A mission runs back to back with no gaps, but pauses entirely while you're
 * using Aspen, so "working" could equally mean thinking, queued behind another
 * mission, waiting on you, or wedged — indistinguishable from the outside. This
 * says which.
 */
function listLive() {
  const missions = load();
  const busyForUser = (() => { try { return foreground.isBusy(); } catch { return false; } })();

  return missions.map((m) => {
    let a;
    if (m.status === 'done') a = { state: 'done', short: 'done', label: 'Done' };
    else if (m.status === 'blocked') a = { state: 'blocked', short: 'needs you', label: 'Blocked — needs your input' };
    else if (m.status === 'stopped') a = { state: 'stopped', short: 'stopped', label: 'Stopped' };
    else if (_runningId === m.id) a = { state: 'running', short: 'working', label: `Working on step ${(m.steps || 0) + 1}` };
    else if (busyForUser) a = { state: 'yielding', short: 'paused', label: 'Paused while you\'re using Aspen — resumes when you\'re idle' };
    else if (_busy) a = { state: 'queued', short: 'queued', label: 'Waiting its turn behind another mission' };
    else a = { state: 'starting', short: 'starting', label: 'Starting next step…' };
    return { ...m, activity: a };
  });
}

module.exports = { init, start, stop, stopAll, guide, status, load, listLive, buildPrompt, tick };
