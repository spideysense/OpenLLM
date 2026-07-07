// Regression guards for the 2026-06-28 stabilization pass. These are coarse
// source-level assertions — they don't test behavior, they prevent the specific
// fixes from being silently undone (the "3 steps forward, 5 back" problem).
// Each failure points at exactly what regressed and why it mattered.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

// ── concurrency: >= 4 parallel slots at every spawn site ──────────────────────
// Why: NUM_PARALLEL=2 meant a 3rd concurrent client queued — the multi-client
// slowness. Must not drift back down.
(function parallelism() {
  const ollama = read('ollama.js');
  const sites = ollama.match(/OLLAMA_NUM_PARALLEL:\s*'(\d+)'/g) || [];
  assert.ok(sites.length >= 2, 'NUM_PARALLEL set at both Ollama spawn sites');
  for (const s of sites) {
    const n = parseInt(s.match(/'(\d+)'/)[1], 10);
    assert.ok(n >= 4, `NUM_PARALLEL must stay >= 4 for multi-client serving (found ${n})`);
  }
})();

// ── no recurring keep-warm heartbeat ──────────────────────────────────────────
// Why: the 45s /api/generate heartbeat stole one of the limited parallel slots
// and was redundant (startup warm-up + keep_alive:-1 + MAX_LOADED=3 already keep
// the model resident). Must not be reintroduced.
(function noKeepWarm() {
  const gw = read('gateway.js');
  assert.ok(!/__aspenKeepWarm/.test(gw), 'keep-warm heartbeat must not return (it steals a parallel slot)');
})();

// ── grounding + anti-sycophancy directive ─────────────────────────────────────
// Why: the model fabricated dates/scores when search came back empty and flipped
// its answer ("you're absolutely right") on pushback. The directive forbids both.
(function grounding() {
  const agent = read('gateway-agent.js');
  assert.ok(/GROUNDING/.test(agent), 'GROUNDING instruction present');
  assert.ok(/web_search/.test(agent), 'directive references web_search');
  assert.ok(/FLIP-FLOP/i.test(agent), 'anti-sycophancy (no flip-flop) instruction present');
  assert.ok(/absolutely right/i.test(agent), 'explicitly forbids caving to pushback without re-verifying');
})();

// ── web_search layering: SearXNG primary, bundled metasearch fallback ─────────
// Why: bare single-source DDG got IP-blocked and returned "No results". The
// resilient path is SearXNG (if configured) -> multi-engine metasearch -> a clean
// no-results message. All five engines must remain wired.
(function searchLayering() {
  const tools = read('tools.js');
  const sx = tools.indexOf('searxngResults(query)');
  const meta = tools.indexOf('metaSearch(query)');
  assert.ok(sx > -1 && meta > -1, 'both SearXNG and metasearch layers present in runSearch');
  assert.ok(sx < meta, 'SearXNG is tried before the bundled metasearch');
  assert.ok(/No results found for/.test(tools), 'graceful no-results fallback retained');
  for (const eng of ['engDdgHtml', 'engDdgLite', 'engBing', 'engMojeek', 'engWikipedia']) {
    assert.ok(tools.includes(eng), `metasearch engine ${eng} still wired`);
  }
})();

// ── iOS: stale-connection (-1005) retry ───────────────────────────────────────
// Why: URLSession reused a dead pooled socket after a box/tunnel restart, so the
// first send failed with "network connection was lost". chat() must retry once on
// a fresh ephemeral session, guarded so it can't duplicate streamed tokens.
(function iosRetry() {
  const box = read('../../ios-native/Aspen/Network/BoxClient.swift');
  assert.ok(/networkConnectionLost/.test(box), 'retries on networkConnectionLost (-1005)');
  assert.ok(/isStaleConnection/.test(box), 'stale-connection classifier present');
  assert.ok(/\.ephemeral/.test(box), 'retry uses a fresh ephemeral URLSession');
  assert.ok(/tokenSeen/.test(box), 'retry guarded so it cannot duplicate streamed tokens');
})();

// ── Cloud Boost: default OFF, explicit opt-in, minimizer on the path ─────────
// Why: the product promise is "nothing leaves the machine". Cloud assist exists
// but must stay opt-in — default off, fires only on an explicit per-request
// boost (or user-chosen auto fallback), always through the context minimizer.
(function cloudOptIn() {
  const cloud = read('cloud.js');
  assert.ok(/CLOUD_MODE \|\| 'off'/.test(cloud), "cloud mode must default to 'off'");
  const gw = read('gateway.js');
  assert.ok(/x-aspen-boost|parsedBody\.boost === true/.test(gw), 'boost requires an explicit per-request flag');
  assert.ok(/syncFromStore/.test(gw), 'gateway reads the user Setting (store) before any cloud call');
  const router = read('cloud-router.js');
  const minimizerOnPath = /minimi/i.test(router) || /minimi/i.test(cloud);
  assert.ok(minimizerOnPath, 'context minimizer must remain on the cloud path');
})();

// ── Action tools survive the capability allow-list ───────────────────────────
// Why: git_* and publish_app are gated by isOwner AND intersected with the
// capabilities allow-list. They were absent from that list, so they were stripped
// before ever reaching the model — which then hallucinated a broken 'GitHub API'.
// They must stay in allowedTools (under runCommand) or the tools silently vanish.
(function actionToolsInAllowList() {
  const caps = read('capabilities.js');
  for (const t of ['git_clone', 'git_status', 'git_commit_push', 'git_create_repo', 'publish_app']) {
    assert.ok(caps.includes(`'${t}'`), `${t} must be in the capabilities allowedTools list (else it's stripped before the model sees it)`);
  }
})();

console.log('regression-guards.test.js: all checks passed');
