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
// Check for upgrade opportunities
// ═══════════════════════════════════════════════════

function checkUpgrades(installedModels, registry, tier) {
  if (!registry?.categories) return [];

  const upgrades = [];
  const installedNames = installedModels.map((m) => m.name.split(':')[0]);

  for (const [category, catData] of Object.entries(registry.categories)) {
    const rec = catData.recommendations?.[tier];
    if (!rec) continue;

    const recBase = rec.model.split(':')[0];
    const isInstalled = installedNames.some(
      (n) => n === recBase || n === rec.model
    );

    if (!isInstalled) {
      // Check if user has an older model in this category that could be upgraded
      const hasOlderVersion = catData.recommendations && Object.values(catData.recommendations).some(
        (r) => {
          const rBase = r.model.split(':')[0];
          return installedNames.includes(rBase) && r.model !== rec.model;
        }
      );

      upgrades.push({
        category,
        recommended: rec,
        type: hasOlderVersion ? 'upgrade' : 'new',
        message: hasOlderVersion
          ? `A better ${category} model is available: ${rec.name}`
          : `Try the best ${category} model for your machine: ${rec.name}`,
      });
    }
  }

  return upgrades;
}

module.exports = { getRegistry, checkUpgrades };
