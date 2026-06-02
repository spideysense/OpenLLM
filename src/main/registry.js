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

// ═══════════════════════════════════════════════════
// Flat-list helpers (schema v3)
// ═══════════════════════════════════════════════════

const TIER_ORDER = { light: 1, medium: 2, heavy: 3, ultra: 4 };

// Models the user's hardware can actually run, power-ranked (registry order is
// already most→least capable). Only tool-capable models are in the registry.
function modelsForTier(registry, tier) {
  if (!Array.isArray(registry?.models)) return [];
  const cap = TIER_ORDER[tier] || 2;
  return registry.models.filter((m) => (TIER_ORDER[m.min_tier] || 2) <= cap);
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

module.exports = { getRegistry, checkUpgrades, modelsForTier, recommendedModel };
