/**
 * Foreground activity tracker.
 *
 * Missions run through the same model on the same GPU as the person's chat, so
 * an unchecked mission competes with the human actually using Aspen and makes
 * everything feel stalled. Every user-facing (non-background) agent run marks
 * the app busy for its duration; missions check this and pause between steps /
 * rounds, then resume on their own once the person is done.
 *
 * The grace window stops a mission from grabbing the GPU in the gap between two
 * quick turns (read the reply, type the next one).
 */
const GRACE_MS = 5000;

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
