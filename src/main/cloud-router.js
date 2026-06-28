// cloud-router.js — selection + rotation across cloud providers.
//
// Policy: free tier FIRST (rotate round-robin so no single free key gets
// hammered), then BYO paid only if no free provider is configured/healthy. A
// provider that 429s or errors goes into a short cooldown and the router rotates
// to the next — this is the "rotate between engines as needed" behaviour, done
// the legitimate way (across providers you hold keys for, not burner accounts).
const { configured, call } = require('./cloud-providers');
const { minimizeForCloud } = require('./context-minimizer');

const COOLDOWN_MS = 60 * 1000;
const cooldownUntil = new Map(); // id -> ts
let rr = 0;                      // round-robin cursor across free tier

function available() {
  const now = Date.now();
  return configured().filter((p) => (cooldownUntil.get(p.id) || 0) < now);
}

// Ordered candidates: free providers first (rotated), then byok.
function order() {
  const all = available();
  const free = all.filter((p) => p.tier === 'free');
  const byok = all.filter((p) => p.tier === 'byok');
  const rotatedFree = free.length ? free.map((_, i) => free[(rr + i) % free.length]) : [];
  if (free.length) rr = (rr + 1) % free.length;
  return [...rotatedFree, ...byok];
}

function marker(p) {
  return `\n\n— ⚡ answered by ${p.label} (${p.tier === 'free' ? 'free cloud tier' : 'your cloud key'}); this request left your machine.`;
}

// Try providers in order, rotating past failures. Returns null if none succeed
// (caller then stays on / falls back to local).
async function routeToCloud(messages, { identifiers = [], keepTurns = 6 } = {}) {
  const min = minimizeForCloud(messages, { identifiers, keepTurns });
  const candidates = order();
  for (const p of candidates) {
    try {
      const { text } = await call(p, min.messages, {});
      if (text && text.trim()) {
        return { text, provider: p.id, label: p.label, tier: p.tier, redactions: min.redactions, marker: marker(p) };
      }
      cooldownUntil.set(p.id, Date.now() + COOLDOWN_MS);
    } catch (e) {
      // 429 / 5xx / network → cooldown and rotate to the next engine
      cooldownUntil.set(p.id, Date.now() + (e.status === 429 ? COOLDOWN_MS * 5 : COOLDOWN_MS));
    }
  }
  return null;
}

module.exports = { routeToCloud, _internal: { order, available, cooldownUntil } };
