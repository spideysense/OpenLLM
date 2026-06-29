// Offline tests: web_search resilience. Locks the behavior fixed on 2026-06-28
// (bare single-source DDG returning "No results" → bundled multi-engine
// metasearch with dedup, consensus ranking, and early-return). No network:
// metaSearch is fed fake in-memory engines.
const assert = require('assert');
const { normUrl, metaSearch, searxngResults } = require('./tools');

// fake engine: resolves after `ms` with `results`; `failing` rejects.
const engine = (ms, results) => () => new Promise((res) => setTimeout(() => res(results), ms));
const failing = (ms) => () => new Promise((_, rej) => setTimeout(() => rej(new Error('blocked')), ms));

// ── normUrl: the dedup key ────────────────────────────────────────────────────
(function testNormUrl() {
  assert.strictEqual(normUrl('https://a.com/'), normUrl('https://a.com'), 'trailing slash ignored');
  assert.strictEqual(
    normUrl('https://a.com/p?utm_source=x&utm_medium=y&ref=z'),
    normUrl('https://a.com/p'),
    'tracking params stripped'
  );
  assert.strictEqual(normUrl('https://A.com/P#frag'), normUrl('https://a.com/P'), 'host lowercased + hash dropped');
  assert.notStrictEqual(normUrl('https://a.com/s?q=1'), normUrl('https://a.com/s?q=2'), 'meaningful query kept');
})();

// ── merge: dedup across engines, keep longest snippet, consensus ranking ──────
(async function testMerge() {
  const engines = [
    engine(10, [
      { title: 'FIFA', link: 'https://fifa.com/m', snippet: 'short' },
      { title: 'ESPN', link: 'https://espn.com', snippet: 'x' },
    ]),
    engine(20, [{ title: 'FIFA', link: 'https://fifa.com/m/?utm_source=ddg', snippet: 'a much longer snippet with real detail' }]),
    engine(30, [{ title: 'ESPN', link: 'https://espn.com/', snippet: 'y' }]), // trailing-slash dupe
    engine(15, [{ title: '', link: 'https://junk.com', snippet: 'no title' }]), // junk: filtered
  ];
  const out = await metaSearch('q', engines);
  assert.strictEqual(out.length, 2, 'deduped to 2 unique results, junk dropped');
  const fifa = out.find((r) => r.link.includes('fifa'));
  const espn = out.find((r) => r.link.includes('espn'));
  assert.ok(fifa && espn, 'both real results present');
  assert.ok(fifa.snippet.includes('longer'), 'kept the longer snippet on dedup');
  assert.ok(!out.some((r) => r.link.includes('junk')), 'empty-title result filtered');
  assert.strictEqual(out[0].link, fifa.link, 'consensus: first-seen 2-hit result ranks first');
})();

// ── early-return: don't wait on a slow engine once we have enough ─────────────
(async function testEarlyReturn() {
  const fast1 = engine(10, Array.from({ length: 4 }, (_, i) => ({ title: 't' + i, link: `https://a${i}.com`, snippet: 'x' })));
  const fast2 = engine(15, Array.from({ length: 4 }, (_, i) => ({ title: 'u' + i, link: `https://b${i}.com`, snippet: 'x' })));
  const slow = engine(3000, [{ title: 'late', link: 'https://late.com', snippet: 'x' }]);
  const t0 = Date.now();
  const out = await metaSearch('q', [fast1, fast2, slow]);
  const dt = Date.now() - t0;
  assert.ok(out.length >= 6, `returned merged fast results (got ${out.length})`);
  assert.ok(dt < 500, `early-returned without waiting on the 3s engine (took ${dt}ms)`);
  assert.ok(!out.some((r) => r.link === 'https://late.com'), 'slow engine result excluded');
})();

// ── a blocked/failing engine never breaks the search ──────────────────────────
(async function testFailingEngines() {
  const good = engine(10, [{ title: 'ok', link: 'https://ok.com', snippet: 'x' }]);
  const out = await metaSearch('q', [failing(5), good, failing(8)]);
  assert.strictEqual(out.length, 1, 'the one good result survives two failing engines');
  assert.strictEqual(out[0].link, 'https://ok.com');
})();

// ── deadline: always resolves, never hangs, even if every engine stalls ───────
(async function testDeadline() {
  const t0 = Date.now();
  const out = await metaSearch('q', [engine(9000, [{ title: 'x', link: 'https://x.com', snippet: 'x' }])], 100);
  const dt = Date.now() - t0;
  assert.ok(Array.isArray(out), 'resolves at the deadline instead of hanging');
  assert.ok(dt < 1000, `honored the ${100}ms deadline (took ${dt}ms)`);
})();

// ── SearXNG is off unless configured (clean fallback, never throws) ───────────
(async function testSearxngDisabled() {
  const out = await searxngResults('anything'); // SEARXNG_URL unset in test env
  assert.deepStrictEqual(out, [], 'searxngResults returns [] when SEARXNG_URL is unset');
})();

console.log('search.test.js: all checks passed');
