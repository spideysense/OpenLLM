// Choose within a reviewed catalog and a measured responsiveness floor. This is
// a bounded qualification policy, not a claim of universally optimal intelligence.
function candidates(tier, registry, budget, accelerated = true) {
  const order = { light: 1, medium: 2, heavy: 3, ultra: 4 };
  const fit = (registry.models || []).filter(m => !m.deprecated && m.tool_support === true && m.download_gb <= budget.memoryGB && (order[m.min_tier] || 2) <= (order[tier] || 2));
  // CPU generation is bandwidth-bound: start with small weights even when the
  // machine has abundant RAM. The user can still select larger models manually.
  const pool = accelerated ? fit : fit.filter(m => m.download_gb <= 5.5);
  const first = pool[0];
  const second = pool.find(m => m.model !== first?.model && m.download_gb <= Math.min(first?.download_gb || Infinity, 5.5));
  return [first, second].filter(Boolean);
}
function choose(results, minTokensPerSecond = 8) {
  const qualified = results.filter(r => r.qualification?.ok && r.qualification.tools && r.benchmark?.tasks.some(t => t.id === 'native-tool-call' && t.passed) && r.benchmark.taskScore >= 0.8);
  const responsive = qualified.filter(r => r.benchmark.warm.medianTokensPerSecond >= minTokensPerSecond);
  const rank = (a, b) => b.benchmark.taskScore - a.benchmark.taskScore || b.benchmark.warm.medianTokensPerSecond - a.benchmark.warm.medianTokensPerSecond;
  return [...(responsive.length ? responsive : qualified)].sort(rank)[0] || null;
}
module.exports = { candidates, choose };
