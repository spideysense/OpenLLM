// ─────────────────────────────────────────────────────────────────────────────
// Model manager — Aspen manages its own models so the user never has to babysit
// memory or quality by hand.
//
//   * Memory: only the ACTIVE chat model (+ the coder, if it co-fits) stays
//     resident. Everything else is evicted, so a leftover 65GB model can't sit
//     in RAM thrashing the box.
//   * Quality: deprecated/superseded models (per the registry) are never
//     recommended, and — when their replacement is installed — are auto-retired
//     to reclaim disk. Guard: never deletes a model that is currently loaded.
//
// Pure decision helpers (keepSet, toEvict, toRetire) are unit-tested; the IO
// wrappers are defensive and never throw into the caller.
// ─────────────────────────────────────────────────────────────────────────────
const OLLAMA = 'http://127.0.0.1:11434';
const registry = require('./registry');

function base(n) { return String(n || '').split(':')[0]; }
function isCoder(n) { return /coder|deepseek-coder|code-/i.test(String(n || '')); }
// Models that code well enough alone that we don't keep a second coder resident.
function isSelfSufficientCoder(n) { return /qwen3|glm-?5|deepseek-v3|gpt-oss/i.test(String(n || '')); }

// pure: choose the active model. If the current active model is DEPRECATED (per
// registry) or unset, switch to the best installed non-deprecated model (registry
// order). Never overrides a valid, non-deprecated user choice — so picking
// qwen3:32b on purpose is respected, but a deprecated scout is migrated off.
function pickActiveModel({ current, installed, reg }) {
  if (!reg || !Array.isArray(reg.models)) return current;
  const curEntry = reg.models.find((m) => base(m.model) === base(current));
  const currentIsDeprecated = !!(curEntry && curEntry.deprecated);
  if (current && !currentIsDeprecated) return current;   // respect a valid choice
  const installedBases = new Set((installed || []).map((m) => base(m.name)));
  for (const m of reg.models) {
    if (m.deprecated) continue;
    if (installedBases.has(base(m.model))) {
      const inst = (installed || []).find((x) => base(x.name) === base(m.model));
      return inst ? inst.name : m.model;
    }
  }
  return current;
}

// ── pure: which base names should stay resident ──────────────────────────────
// Keep the active chat model, plus an installed coder (the router routes coding
// turns to it and it co-fits on big boxes). Everything else is evictable.
function keepSet(activeModel, installed) {
  const keep = new Set([base(activeModel)]);
  // If the active model codes well on its own (qwen3 etc.), do NOT keep a second
  // coder model resident — one model in memory means nothing can evict it and
  // force a reload ("Loading qwen…" every other message).
  if (!isSelfSufficientCoder(activeModel)) {
    const coder = (installed || []).find((m) => isCoder(m.name));
    if (coder) keep.add(base(coder.name));
  }
  return keep;
}

// pure: resident models that aren't in the keep set → should be unloaded.
function toEvict(activeModel, installed, resident) {
  const keep = keepSet(activeModel, installed);
  return (resident || []).map((m) => m.name).filter((n) => !keep.has(base(n)));
}

// pure: retirable models (deprecated + replacement installed) that are NOT
// currently resident → safe to delete. Never deletes something loaded/active.
function toRetire(reg, installed, resident, activeModel) {
  const residentBases = new Set((resident || []).map((m) => base(m.name)));
  const activeBase = base(activeModel);
  return registry
    .retirableModels(reg, installed)
    .map((r) => r.model)
    .filter((m) => !residentBases.has(base(m)) && base(m) !== activeBase);
}

// pure: LEAN mode — retire every installed model except the active chat model
// and the coder (and anything still resident, which we never delete). This keeps
// the box to just the best model + coder, reclaiming disk from redundant models
// like a leftover 65GB gpt-oss the user tried once. Guard lives in manage():
// lean only runs when the active model is actually installed and healthy.
function toRetireLean(activeModel, installed, resident) {
  const keep = keepSet(activeModel, installed);           // active + coder bases
  const residentBases = new Set((resident || []).map((m) => base(m.name)));
  return (installed || [])
    .map((m) => m.name)
    .filter((n) => !keep.has(base(n)) && !residentBases.has(base(n)));
}

// ── IO (defensive) ───────────────────────────────────────────────────────────
async function residentModels() {
  try {
    const res = await fetch(`${OLLAMA}/api/ps`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models || []).map((m) => ({ name: m.name, size: m.size_vram || m.size || 0 }));
  } catch { return []; }
}

async function installedModels() {
  try {
    const res = await fetch(`${OLLAMA}/api/tags`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models || []).map((m) => ({ name: m.name, size: m.size || 0 }));
  } catch { return []; }
}

async function unloadModel(name) {
  // keep_alive:0 tells Ollama to drop the model from memory immediately.
  try {
    await fetch(`${OLLAMA}/api/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: name, keep_alive: 0 }),
    });
    return true;
  } catch { return false; }
}

async function deleteModel(name) {
  try {
    const res = await fetch(`${OLLAMA}/api/delete`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: name }),
    });
    return res.ok;
  } catch { return false; }
}

// ── orchestration ────────────────────────────────────────────────────────────
// Called on startup and whenever the active model changes. Frees memory and,
// if autoRetire is on, reclaims disk from superseded models. Returns a summary
// so the app can surface what it did. Never throws.
async function manage(activeModel, { autoRetire = true, lean = false } = {}) {
  const summary = { active: activeModel, evicted: [], retired: [], freedGB: 0 };
  if (!activeModel) return summary;
  try {
    const [installed, resident, reg] = await Promise.all([
      installedModels(), residentModels(), registry.getRegistry(),
    ]);

    // 1) Evict anything resident that isn't the active model or the coder.
    for (const name of toEvict(activeModel, installed, resident)) {
      if (await unloadModel(name)) summary.evicted.push(name);
    }

    // Wait for those evictions to actually land. Ollama's keep_alive:0 unload is
    // not instant (a 65GB model takes a moment), and if we re-read the resident
    // list too fast we'd skip-then-orphan a model we just told it to unload —
    // which is exactly how gpt-oss:120b survived. Poll up to ~6s until nothing
    // outside the keep set is still resident.
    let freshResident = await residentModels();
    for (let i = 0; i < 6 && toEvict(activeModel, installed, freshResident).length; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      freshResident = await residentModels();
    }
    const activeInstalled = installed.some((m) => base(m.name) === base(activeModel));

    // 2) Reclaim disk. LEAN mode (default) keeps only active + coder and retires
    //    everything else. Otherwise retire only registry-deprecated models.
    //    Safety: lean only runs if the active model is actually installed — never
    //    strip the box down around a missing/broken active model.
    if (lean && activeInstalled) {
      for (const name of toRetireLean(activeModel, installed, freshResident)) {
        const m = installed.find((x) => base(x.name) === base(name));
        if (await deleteModel(name)) {
          summary.retired.push(name);
          summary.freedGB += m ? (m.size || 0) / 1e9 : 0;
        }
      }
    } else if (autoRetire && reg) {
      for (const name of toRetire(reg, installed, freshResident, activeModel)) {
        const m = installed.find((x) => base(x.name) === base(name));
        if (await deleteModel(name)) {
          summary.retired.push(name);
          summary.freedGB += m ? (m.size || 0) / 1e9 : 0;
        }
      }
    }
  } catch { /* never break startup over model housekeeping */ }
  return summary;
}

module.exports = {
  keepSet, toEvict, toRetire, toRetireLean, pickActiveModel,
  residentModels, installedModels, unloadModel, deleteModel, manage,
};
