/**
 * Foreground activity tracker.
 *
 * Missions run through the same model on the same GPU as the person's chat, so
 * an unchecked mission competes with the human actually using Aspen and makes
 * everything feel stalled. Every user-facing (non-background) agent run marks
 * the app busy for its duration; missions check this and pause between steps /
 * rounds, then resume on their own once the person is done.
 *
 * The grace window is deliberately long: a person "using Aspen" is reading the
 * reply, thinking, and typing the next thing — not just waiting on tokens. A
 * mission that jumps back in seconds after a reply lands still ruins the session.
 * So missions wait for a real stretch of idleness before resuming.
 */
const GRACE_MS = 120000; // 2 minutes of no foreground turns before missions resume

let active = 0;
let lastEnd = 0;

function begin() {
  active += 1;
}

function end() {
  active = Math.max(0, active - 1);
  if (active === 0) lastEnd = Date.now();
}

/** True while a person is mid-turn, or just finished one. */
function isBusy() {
  return active > 0 || Date.now() - lastEnd < GRACE_MS;
}

module.exports = { begin, end, isBusy, GRACE_MS };
