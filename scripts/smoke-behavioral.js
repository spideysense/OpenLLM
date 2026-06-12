#!/usr/bin/env node
/**
 * Behavioral smoke harness.
 *
 * The vitest suite checks that code is SHAPED right (grep-level). It cannot catch
 * runtime behavior: a timeout firing while a model thinks, a query that should
 * search but doesn't, a tool call that errors. Those route through the user as
 * screenshots — the expensive way. This harness closes that loop: it drives the
 * REAL agent code path (gateway-agent.run) against the REAL local Ollama with a
 * handful of representative prompts and asserts on BEHAVIOR (control flow), not
 * on exact model text (which is nondeterministic).
 *
 * Two layers:
 *   1) Deterministic logic — no model needed (trigger routing, capability tiers).
 *      These run always and are the fast guard against the regressions we've hit.
 *   2) Live model — requires Ollama running with >=1 model. Asserts prompts
 *      actually complete (no false timeout, no crash) and that search queries
 *      invoke web_search end to end.
 *
 * Usage:  node scripts/smoke-behavioral.js
 * Exit 0 = all assertions passed (or live layer cleanly skipped, no Ollama).
 * Exit 1 = a real behavioral failure.
 */
'use strict';
const http = require('http');
const gw = require('../src/main/gateway-agent');
const capabilities = require('../src/main/capabilities');

const DETERMINISTIC_ONLY = process.argv.includes('--deterministic-only');
const OLLAMA = { host: '127.0.0.1', port: 11434 };
const results = [];
let LAYER = 'deterministic';
function record(name, ok, detail) { results.push({ name, ok, detail: detail || '', layer: LAYER }); const tag = ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'; console.log(`  ${tag} ${name}${detail ? `  — ${detail}` : ''}`); }

// ── tiny ollama helpers (no electron) ──
function ollamaGet(path, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const req = http.request({ ...OLLAMA, path, method: 'GET' }, (res) => {
      let body = ''; res.on('data', (d) => (body += d)); res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}
async function listModels() {
  try { const r = await ollamaGet('/api/tags'); const j = JSON.parse(r.body); return (j.models || []).map((m) => m.name); }
  catch { return null; } // null = Ollama not reachable
}

// Drive the real agent and collect events with a hard wall-clock cap. Prints a
// live heartbeat so a slow model never looks like a hang.
async function runCase(model, userText, { timeoutMs = 240000, label = '' } = {}) {
  const events = [];
  const start = Date.now();
  let ticker = null;
  if (label) {
    process.stdout.write(`  ⏳ ${label} — running`);
    ticker = setInterval(() => process.stdout.write(`\r  ⏳ ${label} — running (${Math.round((Date.now() - start) / 1000)}s)`), 2000);
  }
  const messages = [{ role: 'user', content: userText }];
  const iterator = gw.run({ model, messages, isOwner: true });
  let timedOut = false;
  const guard = new Promise((resolve) => setTimeout(() => { timedOut = true; resolve(); }, timeoutMs));
  await Promise.race([
    (async () => { for await (const ev of iterator) { events.push(ev); if (ev.type === 'done' || ev.type === 'error') break; } })(),
    guard,
  ]);
  if (ticker) { clearInterval(ticker); process.stdout.write('\r' + ' '.repeat(60) + '\r'); }
  const content = events.filter((e) => e.type === 'content').map((e) => e.text).join('');
  const toolCalls = events.filter((e) => e.type === 'tool_call').map((e) => e.name);
  const error = events.find((e) => e.type === 'error');
  return { events, content, toolCalls, error, ms: Date.now() - start, timedOut };
}

// ── Layer 1: deterministic (no model) ──
function deterministicChecks() {
  console.log('\n\x1b[1mDeterministic logic (no model)\x1b[0m');

  // Trigger routing — the coffee regression.
  const shouldSearch = ['good place to get coffee in burlingame that\u2019s not a chain', 'best ramen near me', 'where can I find a dentist', 'recommend a hotel in tahoe', 'what\u2019s the weather today'];
  const shouldNot = ['hello', 'write me a haiku about rain', 'explain photosynthesis', 'thanks!'];
  let tOk = true;
  for (const q of shouldSearch) if (!gw.messageNeedsTools([{ role: 'user', content: q }])) { tOk = false; record(`routes to search: "${q.slice(0, 32)}…"`, false, 'did NOT trigger'); }
  for (const q of shouldNot) if (gw.messageNeedsTools([{ role: 'user', content: q }])) { tOk = false; record(`stays fast chat: "${q}"`, false, 'falsely triggered'); }
  if (tOk) record('tool routing: local/recommendation → search, chat → fast', true, `${shouldSearch.length + shouldNot.length} cases`);

  // Capability tiers — the degradation policy.
  const tier = (caps, hw = 'medium') => capabilities.computeProfile(caps, hw).tier;
  const cap = [
    [tier({ tools: true, sizeB: 3 }) === 'chat', '4B-class → chat'],
    [tier({ tools: true, sizeB: 8 }) === 'standard', '8B → standard'],
    [tier({ tools: true, sizeB: 32 }) === 'full', '32B → full'],
    [capabilities.computeProfile({ tools: true, vision: true, sizeB: 26 }, 'light').features.computerUse === false, 'light HW disables computer use'],
    [tier({ tools: false, sizeB: 32 }) === 'chat', 'no-tools model → chat'],
  ];
  const capOk = cap.every(([ok]) => ok);
  cap.filter(([ok]) => !ok).forEach(([, label]) => record(`capability: ${label}`, false, 'wrong tier'));
  if (capOk) record('capability tiers: 4B/8B/32B/vision/light all correct', true, `${cap.length} cases`);
}

// ── Layer 2: live model (needs Ollama) ──
async function liveChecks(models) {
  LAYER = 'live';
  console.log('\n\x1b[1mLive model (real Ollama)\x1b[0m');

  // Pick a tool-capable model (prefer a mid/large one) and a small one if present.
  const profiles = {};
  for (const m of models) { try { profiles[m] = await capabilities.getProfile(m, { force: true }); } catch {} }
  const toolModel = models.find((m) => profiles[m] && profiles[m].allowedTools.includes('web_search')) || models[0];
  const chatModel = models.find((m) => profiles[m] && profiles[m].tier === 'chat');

  console.log(`  (tool model: ${toolModel}${chatModel ? `, chat-tier model: ${chatModel}` : ''})`);

  // 1) Plain chat completes with a non-empty answer and no error.
  {
    const r = await runCase(toolModel, 'In one sentence, what is a hash map?', { timeoutMs: 180000, label: 'plain chat' });
    record('plain chat completes (no error, non-empty)', !r.error && !r.timedOut && r.content.trim().length > 0,
      r.error ? r.error.text : r.timedOut ? 'WALL-CLOCK TIMEOUT' : `${r.ms}ms, ${r.content.length} chars`);
  }

  // 2) THE timeout regression: a heavier prompt must complete, not false-timeout.
  {
    const r = await runCase(toolModel, 'Explain in a short paragraph how TLS establishes a session key.', { timeoutMs: 240000, label: 'heavy prompt (no false timeout)' });
    const stalled = r.error && /stall|no output|timed out/i.test(r.error.text || '');
    record('heavy/reasoning prompt completes (no false timeout)', !r.error && !r.timedOut,
      stalled ? `FALSE TIMEOUT: ${r.error.text}` : r.error ? r.error.text : r.timedOut ? 'WALL-CLOCK TIMEOUT' : `${(r.ms / 1000).toFixed(1)}s`);
  }

  // 3) Search round-trip: a local lookup should invoke web_search and answer.
  {
    const r = await runCase(toolModel, 'Find me a good independent coffee shop in Burlingame, CA (not a chain).', { timeoutMs: 240000, label: 'search round-trip' });
    const searched = r.toolCalls.includes('web_search');
    record('local lookup invokes web_search end to end', searched && !r.error,
      r.error ? r.error.text : searched ? `tools: [${r.toolCalls.join(', ')}], ${(r.ms / 1000).toFixed(1)}s` : `NO SEARCH (tools: [${r.toolCalls.join(', ') || 'none'}])`);
  }

  // 4) Chat-tier model never enters the tool loop (stays fast) — if one is installed.
  if (chatModel) {
    const r = await runCase(chatModel, 'Find me a coffee shop in Burlingame.', { timeoutMs: 180000, label: 'chat-tier stays tool-free' });
    record('chat-tier model stays tool-free (fast path)', r.toolCalls.length === 0 && !r.error,
      r.error ? r.error.text : `tools: [${r.toolCalls.join(', ') || 'none'}], ${(r.ms / 1000).toFixed(1)}s`);
  } else {
    record('chat-tier model stays tool-free', true, 'skipped — no <5B model installed');
  }
}

(async () => {
  console.log('\x1b[1m\nAspen behavioral smoke test\x1b[0m');
  deterministicChecks();

  const models = await listModels();
  if (DETERMINISTIC_ONLY) {
    console.log('\n\x1b[2mLive model layer skipped (--deterministic-only). Run `npm run smoke` for the full check.\x1b[0m');
  } else if (!models) {
    console.log('\n\x1b[33mLive model layer skipped — Ollama not reachable on 127.0.0.1:11434.\x1b[0m');
    console.log('(Start Ollama and re-run to exercise the real agent against a model.)');
  } else if (models.length === 0) {
    console.log('\n\x1b[33mLive model layer skipped — Ollama is up but no models are installed.\x1b[0m');
  } else {
    await liveChecks(models);
  }

  const failed = results.filter((r) => !r.ok);
  const detFailed = failed.filter((r) => r.layer === 'deterministic');
  const liveFailed = failed.filter((r) => r.layer === 'live');
  const liveNonFatal = process.env.SMOKE_LIVE_NONFATAL === '1';

  console.log('\n' + '─'.repeat(54));
  console.log(`${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) {
    console.log('\x1b[31mFAILED:\x1b[0m');
    failed.forEach((f) => console.log(`  • [${f.layer}] ${f.name}${f.detail ? ` — ${f.detail}` : ''}`));
  }
  // Deterministic failures are always fatal (they're real regressions). Live
  // failures can be made advisory for releases (model nondeterminism) via
  // SMOKE_LIVE_NONFATAL=1, but still print loudly.
  if (detFailed.length || (liveFailed.length && !liveNonFatal)) {
    process.exit(1);
  }
  if (liveFailed.length && liveNonFatal) {
    console.log('\x1b[33m⚠️  Live-layer checks failed but are advisory for this run — review above.\x1b[0m');
    process.exit(0);
  }
  console.log('\x1b[32m✅ Behavioral smoke test passed.\x1b[0m');
  process.exit(0);
})().catch((e) => { console.error('Harness crashed:', e); process.exit(1); });
