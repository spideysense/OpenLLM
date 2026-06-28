// Offline tests: privacy minimizer + provider rotation/cooldown. No network.
const assert = require('assert');

// ── context-minimizer ────────────────────────────────────────────────────────
const { minimizeForCloud, redactText } = require('./context-minimizer');

(function testRedaction() {
  const s = 'mail me at jane.doe@acme.com, key sk-ABCDEFGHIJKL12345, ip 10.0.0.5, /Users/mayank/secret, call +1 (415) 555-1212';
  const { text, hits } = redactText(s);
  assert(!/jane\.doe@acme\.com/.test(text), 'email redacted');
  assert(!/sk-ABCDEFGHIJKL/.test(text), 'secret redacted');
  assert(text.includes('/Users/[user]'), 'home path redacted');
  assert(!/10\.0\.0\.5/.test(text), 'ip redacted');
  assert(hits >= 5, 'counted redactions');
})();

(function testMinimizeTrimAndSystem() {
  const msgs = [
    { role: 'system', content: 'You are Aspen on Mayank\'s box at /Users/mayank. Files: /home/mayank/x.' },
    ...Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `turn ${i} email u${i}@x.com` })),
  ];
  const { messages, redactions } = minimizeForCloud(msgs, { keepTurns: 4, identifiers: ['Mayank'] });
  assert.strictEqual(messages[0].role, 'system', 'system kept');
  assert(!/Mayank|\/Users\/mayank/.test(messages[0].content), 'system sanitized of personal/local context');
  assert.strictEqual(messages.length, 1 + 4, 'trimmed to keepTurns + system');
  assert(messages.slice(1).every((m) => !/@x\.com/.test(m.content)), 'emails redacted in turns');
  assert(redactions > 0, 'redactions counted');
})();

// ── rotation + cooldown ──────────────────────────────────────────────────────
process.env.GEMINI_API_KEY = 'k';   // enables gemini_flash (free) + gemini_pro (byok)
process.env.GROQ_API_KEY = 'k';     // free
process.env.ANTHROPIC_API_KEY = 'k';// byok
const { _internal } = require('./cloud-router');

(function testFreeFirstAndRotation() {
  const a = _internal.order().map((p) => p.id);
  assert(a[0].startsWith('gemini_flash') || a[0] === 'groq', 'free provider first');
  assert(a.includes('anthropic'), 'byok included after free');
  const freeIdx = a.indexOf('anthropic');
  assert(a.slice(0, freeIdx).every((id) => ['gemini_flash', 'groq'].includes(id)), 'all free before byok');
  const b = _internal.order().map((p) => p.id);
  assert.notStrictEqual(a[0], b[0], 'free tier rotates between calls');
})();

(function testCooldownSkips() {
  _internal.cooldownUntil.set('groq', Date.now() + 60000);
  const ids = _internal.available().map((p) => p.id);
  assert(!ids.includes('groq'), 'cooled-down provider skipped');
  _internal.cooldownUntil.clear();
})();

console.log('cloud.test.js: ALL PASS');
