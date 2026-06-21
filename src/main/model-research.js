// ─────────────────────────────────────────────────────────────────────────────
// Model research — Aspen keeps its own model rankings fresh.
//
// Weekly, Aspen researches the current best-in-class LOCAL, tool-capable models
// (using its own web_search + model), verifies each candidate against hard
// constraints, rewrites the quality registry, and — depending on the autonomy
// setting — can pull and swap to the new best automatically.
//
// SAFETY is the whole point of this module. An LLM researching models can
// hallucinate names, suggest cloud-only or oversized models, or pick something
// tool-incompatible. So nothing it proposes is trusted until it passes
// verifyCandidate (pure, tested) AND, before any swap, a live smoke test. The
// currently-working model is NEVER removed until a replacement is proven good.
//
// Autonomy levels (store key `modelAutonomy`):
//   'off'      — do nothing
//   'rankings' — research + rewrite the registry only (no downloads, no swaps)
//   'full'     — rankings + auto-pull the new best + smoke-test + swap + retire old
// ─────────────────────────────────────────────────────────────────────────────

function baseName(n) { return String(n || '').split(':')[0]; }
function isCoder(n) { return /coder|deepseek-coder|code-/i.test(String(n || '')); }

// ── pure: is a researched candidate safe to trust? ───────────────────────────
function verifyCandidate(c, { tierCapGB }) {
  if (!c || typeof c !== 'object') return { ok: false, reason: 'not an object' };
  const model = String(c.model || '');
  if (!/^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._-]*$/i.test(model)) {
    return { ok: false, reason: 'model is not a valid ollama name:tag' };
  }
  if (/:cloud$/i.test(model)) return { ok: false, reason: 'cloud-only model — breaks local-only guarantee' };
  if (isCoder(model)) return { ok: false, reason: 'coder model — handled separately, not a chat model' };
  if (c.tool_support !== true) return { ok: false, reason: 'no confirmed tool support' };
  const gb = Number(c.approx_gb);
  if (!Number.isFinite(gb) || gb <= 0) return { ok: false, reason: 'missing/invalid size' };
  if (tierCapGB && gb > tierCapGB) return { ok: false, reason: `too large for hardware (${gb}GB > ${tierCapGB}GB)` };
  return { ok: true };
}

// ── pure: merge verified candidates into a fresh registry ─────────────────────
// `verified` is ordered best-first. They go to the top of the registry. Existing
// models are preserved (as fallbacks) unless explicitly superseded. If the new
// #1 differs from the previous #1, the previous #1 is marked deprecated +
// superseded_by so the model-manager can retire it once the new one is installed.
function buildUpdatedRegistry(currentReg, verified, { supersedePrevTop = true } = {}) {
  const reg = JSON.parse(JSON.stringify(currentReg || { schema_version: 3, models: [] }));
  const prevTop = (reg.models || []).find((m) => !m.deprecated) || null;

  const seen = new Set();
  const top = [];
  for (const c of verified) {
    const b = baseName(c.model);
    if (seen.has(b)) continue;
    seen.add(b);
    top.push({
      model: c.model,
      name: c.name || c.model,
      provider: c.provider || 'unknown',
      download_gb: Math.round(Number(c.approx_gb) || 0),
      min_tier: c.min_tier || 'heavy',
      tool_support: true,
      why: c.why || 'Researched best-in-class for local tool use.',
      researched: true,
    });
  }

  const newTopBase = baseName(top[0]?.model);
  const rest = [];
  for (const m of reg.models || []) {
    if (seen.has(baseName(m.model))) continue; // replaced by a fresher entry above
    const copy = { ...m };
    // Deprecate the previous best if a genuinely different new best arrived.
    if (supersedePrevTop && prevTop && baseName(copy.model) === baseName(prevTop.model)
        && newTopBase && newTopBase !== baseName(prevTop.model)) {
      copy.deprecated = true;
      copy.superseded_by = top[0].model;
      copy.why = `Superseded by ${top[0].name} (newer best-in-class). Not recommended.`;
    }
    rest.push(copy);
  }

  reg.models = [...top, ...rest];
  reg.updated = new Date().toISOString().slice(0, 10);
  reg.changelog = `Auto-researched ${reg.updated}: top = ${top.map((t) => t.model).join(', ') || '(none)'}.`;
  return reg;
}

// ── research: ask Aspen's own search + model for current best models ──────────
// searchFn(query) -> string of results; chatFn(prompt) -> string (model reply).
// Both injected so this is testable and so it uses the user's machine/IP.
async function researchCandidates({ tierCapGB, searchFn, chatFn }) {
  const queries = [
    'best local LLM tool calling function calling 2026',
    'best ollama model agentic tool use this month',
    'new ollama models released tool calling benchmark',
  ];
  let evidence = '';
  for (const q of queries) {
    try { evidence += `\n\n## ${q}\n` + (await searchFn(q) || '').slice(0, 2500); } catch {}
  }
  if (!evidence.trim()) return [];

  const prompt =
`You are Aspen's model scout. From the web evidence below, identify the best LOCAL,
tool-capable chat models that fit in ${tierCapGB}GB of memory and run via Ollama.
Rules: local only (no ":cloud" tags), must support tool/function calling, must be a
general chat model (NOT a "-coder" model), must fit ${tierCapGB}GB. Prefer MoE models
that stream fast. Rank best first.

Return ONLY a JSON array, no prose, no markdown fences. Each item:
{"model":"<ollama name:tag>","name":"<display>","provider":"<org>","approx_gb":<number>,"min_tier":"heavy","tool_support":true,"why":"<one sentence>"}

Web evidence:${evidence.slice(0, 9000)}`;

  let raw = '';
  try { raw = await chatFn(prompt); } catch { return []; }
  return parseCandidates(raw);
}

// Defensive JSON extraction — models wrap arrays in prose or code fences.
function parseCandidates(raw) {
  if (!raw) return [];
  let s = String(raw).replace(/```json|```/gi, '').trim();
  const a = s.indexOf('['), b = s.lastIndexOf(']');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  try {
    const arr = JSON.parse(s);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

// ── best-effort: does the model tag actually resolve on the Ollama library? ───
async function isResolvable(model) {
  try {
    const res = await fetch(`https://ollama.com/library/${baseName(model)}`, { method: 'GET' });
    return res.ok;
  } catch { return true; } // network blocked? don't block on this signal alone
}

// ── orchestration ────────────────────────────────────────────────────────────
// deps: { tierCapGB, searchFn, chatFn, getRegistry, saveRegistry, installed,
//         pullModel, smokeTest, setActive, manager, store }
// Returns a summary describing what changed. Never throws.
async function runRefresh(autonomy, deps) {
  const summary = { autonomy, ranked: [], pulled: null, swappedTo: null, skipped: [], errors: [] };
  if (autonomy === 'off') return summary;
  try {
    const candidates = await researchCandidates(deps);
    const verified = [];
    for (const c of candidates) {
      const v = verifyCandidate(c, { tierCapGB: deps.tierCapGB });
      if (!v.ok) { summary.skipped.push({ model: c?.model, reason: v.reason }); continue; }
      if (deps.checkResolvable && !(await isResolvable(c.model))) {
        summary.skipped.push({ model: c.model, reason: 'tag did not resolve on Ollama library' });
        continue;
      }
      verified.push(c);
    }
    if (!verified.length) { summary.errors.push('no candidate passed verification'); return summary; }

    // 1) Always-safe: rewrite the registry rankings.
    const cur = await deps.getRegistry();
    const updated = buildUpdatedRegistry(cur, verified);
    await deps.saveRegistry(updated);
    summary.ranked = verified.map((c) => c.model);

    if (autonomy !== 'full') return summary;

    // 2) Full autonomy: if the new best isn't installed, pull → smoke-test → swap.
    const best = verified[0].model;
    const installedBases = new Set((deps.installed || []).map((m) => baseName(m.name)));
    if (installedBases.has(baseName(best))) { summary.swappedTo = best; await deps.setActive(best); return summary; }

    try {
      await deps.pullModel(best);
      summary.pulled = best;
    } catch (e) { summary.errors.push(`pull failed: ${e.message}`); return summary; }

    // Prove it actually works (chat + a tool call) BEFORE making it the default.
    let ok = false;
    try { ok = await deps.smokeTest(best); } catch (e) { summary.errors.push(`smoke test threw: ${e.message}`); }
    if (!ok) {
      summary.errors.push('new model failed smoke test — keeping current model');
      return summary;
    }

    // Verified good → promote, and let the manager retire the now-superseded old one.
    await deps.setActive(best);
    summary.swappedTo = best;
    try { if (deps.manager) await deps.manager.manage(best, { autoRetire: true }); } catch {}
  } catch (e) {
    summary.errors.push(e.message);
  }
  return summary;
}

module.exports = {
  verifyCandidate, buildUpdatedRegistry, parseCandidates, researchCandidates,
  isResolvable, runRefresh,
};
