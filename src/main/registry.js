const path = require('path');
const fs = require('fs');
const store = require('./store');

const REMOTE_REGISTRY_URL = 'https://raw.githubusercontent.com/spideysense/OpenLLM/main/registry/models.json';
const LOCAL_REGISTRY_PATH = path.join(__dirname, '..', '..', 'registry', 'models.json');

// Cache for 1 hour
let cachedRegistry = null;
let cacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000;

// ═══════════════════════════════════════════════════
// Fetch registry (local fallback → remote)
// ═══════════════════════════════════════════════════

async function getRegistry() {
  if (cachedRegistry && Date.now() - cacheTime < CACHE_TTL) {
    return cachedRegistry;
  }

  // Aspen's own researched registry is authoritative on this box — the weekly
  // research job keeps it fresh. Prefer it over the remote seed when present.
  try {
    const local = store.get('researchedRegistry');
    if (local && local.reg && Array.isArray(local.reg.models)) {
      cachedRegistry = local.reg;
      cacheTime = Date.now();
      return cachedRegistry;
    }
  } catch { /* fall through */ }

  // Try remote first
  try {
    const res = await fetch(REMOTE_REGISTRY_URL);
    if (res.ok) {
      cachedRegistry = await res.json();
      cacheTime = Date.now();
      store.set('lastRegistry', cachedRegistry);
      return cachedRegistry;
    }
  } catch {
    // Fall through to local
  }

  // Try cached in store
  const stored = store.get('lastRegistry');
  if (stored) {
    cachedRegistry = stored;
    cacheTime = Date.now();
    return cachedRegistry;
  }

  // Fall back to bundled local
  try {
    const raw = fs.readFileSync(LOCAL_REGISTRY_PATH, 'utf8');
    cachedRegistry = JSON.parse(raw);
    cacheTime = Date.now();
    return cachedRegistry;
  } catch {
    return null;
  }
}

// Persist a registry produced by the research job. Becomes authoritative (see
// getRegistry precedence) and refreshes the in-process cache immediately.
function saveRegistry(reg) {
  if (!reg || !Array.isArray(reg.models)) return false;
  try {
    store.set('researchedRegistry', { reg, at: Date.now() });
    cachedRegistry = reg;
    cacheTime = Date.now();
    return true;
  } catch { return false; }
}

// ═══════════════════════════════════════════════════
// Flat-list helpers (schema v3)
// ═══════════════════════════════════════════════════

const TIER_ORDER = { light: 1, medium: 2, heavy: 3, ultra: 4 };

// Models the user's hardware can actually run, power-ranked (registry order is
// already most→least capable). Only tool-capable models are in the registry.
// Deprecated models (superseded by a better one) are skipped so Aspen never
// recommends or auto-selects them.
function modelsForTier(registry, tier) {
  if (!Array.isArray(registry?.models)) return [];
  const cap = TIER_ORDER[tier] || 2;
  return registry.models.filter((m) => !m.deprecated && (TIER_ORDER[m.min_tier] || 2) <= cap);
}

// Registry quality rank for an installed model's base name. Lower = better.
// Deprecated models are pushed to the bottom. Used by the router to pick the
// best chat model by QUALITY, not by size (which used to resurrect 65GB scout).
function qualityRank(registry, modelName) {
  const base = String(modelName || '').split(':')[0];
  const models = registry?.models || [];
  const idx = models.findIndex((m) => String(m.model).split(':')[0] === base);
  if (idx < 0) return 9999;                       // unknown → unranked
  if (models[idx].deprecated) return 9000 + idx;  // deprecated → bottom
  return idx;                                      // registry order = quality
}

// Installed models that are deprecated (superseded) AND have their replacement
// installed — safe to retire to free space. Returns [{model, superseded_by}].
function retirableModels(registry, installedModels) {
  if (!Array.isArray(registry?.models)) return [];
  const installedBases = (installedModels || []).map((m) => String(m.name).split(':')[0]);
  const out = [];
  for (const m of registry.models) {
    if (!m.deprecated || !m.superseded_by) continue;
    const base = String(m.model).split(':')[0];
    const replBase = String(m.superseded_by).split(':')[0];
    if (installedBases.includes(base) && installedBases.includes(replBase)) {
      out.push({ model: m.model, superseded_by: m.superseded_by });
    }
  }
  return out;
}

// The single best model the user's machine can run = first runnable in the
// power-ranked list. Returns the model id to tag as "Recommended".
function recommendedModel(registry, tier) {
  const runnable = modelsForTier(registry, tier);
  return runnable[0]?.model || null;
}

// Check for upgrade opportunities: is the best model the user *could* run not
// yet installed? If so, suggest it.
function checkUpgrades(installedModels, registry, tier) {
  if (!Array.isArray(registry?.models)) return [];
  const best = modelsForTier(registry, tier)[0];
  if (!best) return [];
  const installedBases = installedModels.map((m) => m.name.split(':')[0]);
  const bestBase = best.model.split(':')[0];
  const haveBest = installedBases.includes(bestBase);
  if (haveBest) return [];
  return [{
    recommended: best,
    type: 'upgrade',
    message: `${best.name} is the most capable model your machine can run`,
  }];
}

module.exports = { getRegistry, saveRegistry, checkUpgrades, modelsForTier, recommendedModel, qualityRank, retirableModels };
