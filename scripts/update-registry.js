#!/usr/bin/env node
/**
 * Auto-update model registry by checking Ollama's library for new models.
 *
 * Runs as a GitHub Action (weekly cron) or manually: node scripts/update-registry.js
 *
 * Logic:
 * 1. Fetch tags for watched model families from Ollama
 * 2. Compare against current registry/models.json
 * 3. If new models found that meet criteria, add them
 * 4. Write updated registry (GitHub Action commits + pushes)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const REGISTRY_PATH = path.join(__dirname, '..', 'registry', 'models.json');

// Model families to watch. When Ollama publishes a new size/variant, we detect it.
const WATCH_FAMILIES = [
  { family: 'gemma4',   provider: 'Google',  tool_support: true },
  { family: 'qwen3',    provider: 'Alibaba', tool_support: true },
  { family: 'llama4',   provider: 'Meta',    tool_support: true },
  { family: 'llama3.1', provider: 'Meta',    tool_support: true },
  { family: 'llama3.2', provider: 'Meta',    tool_support: true },
  { family: 'qwen2.5',  provider: 'Alibaba', tool_support: true },
  { family: 'phi4',     provider: 'Microsoft', tool_support: true },
  { family: 'mistral',  provider: 'Mistral', tool_support: true },
  { family: 'deepseek-r1', provider: 'DeepSeek', tool_support: false },
];

// Size-to-tier mapping (download GB → min_tier)
function sizeToTier(gb) {
  if (gb >= 40) return 'ultra';
  if (gb >= 15) return 'heavy';
  if (gb >= 5)  return 'medium';
  return 'light';
}

// Friendly name from Ollama tag
function friendlyName(family, tag) {
  const base = family.charAt(0).toUpperCase() + family.slice(1);
  // Clean up tag: "12b" → "12B", "e4b" → "E4B", etc.
  const size = tag.replace(/(\d+)b/gi, (_, n) => `${n}B`).replace(/e(\d+)b/gi, (_, n) => `E${n}B`).toUpperCase();
  return `${base} ${size}`.replace(/(\d)([A-Z])/g, '$1 $2').trim();
}

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Aspen-Registry-Bot/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(fetch(res.headers.location));
      }
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

async function getOllamaTags(family) {
  try {
    // Ollama's API for model tags
    const html = await fetch(`https://ollama.com/library/${family}/tags`);
    // Parse tags from the page — look for tag names and sizes
    const tags = [];
    const tagPattern = new RegExp(`${family}:([\\w.-]+)`, 'g');
    const seen = new Set();
    let match;
    while ((match = tagPattern.exec(html)) !== null) {
      const tag = match[1];
      if (seen.has(tag)) continue;
      seen.add(tag);
      // Skip non-standard tags (quantization variants, sha refs)
      if (tag.match(/^[a-f0-9]{12}$/)) continue;      // SHA refs
      if (tag.match(/^(latest|fp16|q[0-9]|iq[0-9])/)) continue;  // quantization
      tags.push(tag);
    }
    // Try to get sizes from the page
    const sizePattern = /(\d+(?:\.\d+)?)\s*(?:GB|gb)/g;
    const sizes = [];
    while ((match = sizePattern.exec(html)) !== null) {
      sizes.push(parseFloat(match[1]));
    }
    return { tags, sizes, raw: html };
  } catch (e) {
    console.error(`  Failed to fetch tags for ${family}: ${e.message}`);
    return { tags: [], sizes: [] };
  }
}

async function main() {
  console.log('=== Aspen Model Registry Auto-Update ===\n');

  // Load current registry
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  const existingModels = new Set(registry.models.map((m) => m.model));
  let updated = false;

  for (const watch of WATCH_FAMILIES) {
    process.stdout.write(`Checking ${watch.family}... `);
    const { tags } = await getOllamaTags(watch.family);

    if (tags.length === 0) {
      console.log('no tags found');
      continue;
    }

    console.log(`${tags.length} tags: ${tags.slice(0, 8).join(', ')}`);

    for (const tag of tags) {
      const modelId = `${watch.family}:${tag}`;
      if (existingModels.has(modelId)) continue;

      // Only add standard size variants (e.g., "12b", "7b", "e4b", "3b")
      if (!tag.match(/^(e?\d+b|scout|dense|latest)(-mlx)?$/i)) continue;
      if (tag.includes('mlx')) continue; // skip MLX-specific tags, they're variants

      // Estimate size — this is rough, we'd ideally fetch from API
      const sizeMatch = tag.match(/(\d+)/);
      const paramB = sizeMatch ? parseInt(sizeMatch[1]) : 7;
      // Rough: 1B params ≈ 0.6GB download (Q4 quantized)
      const estGB = Math.round(paramB * 0.65 * 10) / 10;
      const tier = sizeToTier(estGB);
      const name = friendlyName(watch.family, tag);

      console.log(`  NEW: ${modelId} (~${estGB}GB, tier: ${tier}) → "${name}"`);

      // Insert in the right position (after same family, or by tier)
      const insertIdx = registry.models.findIndex(
        (m) => m.model.startsWith(watch.family + ':') && sizeToTier(m.download_gb) === tier
      );
      const entry = {
        model: modelId,
        name,
        provider: watch.provider,
        download_gb: estGB,
        min_tier: tier,
        tool_support: watch.tool_support,
        why: `Auto-detected from Ollama library. Verify size and capabilities.`,
      };

      if (insertIdx >= 0) {
        registry.models.splice(insertIdx + 1, 0, entry);
      } else {
        registry.models.push(entry);
      }
      existingModels.add(modelId);
      updated = true;
    }
  }

  if (updated) {
    registry.updated = new Date().toISOString().split('T')[0];
    registry.changelog = `Auto-updated ${registry.updated}: new models detected from Ollama library.`;
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');
    console.log(`\n✅ Registry updated → ${REGISTRY_PATH}`);
    // Signal to GitHub Action that there are changes
    process.exit(0);
  } else {
    console.log('\n✅ Registry is up to date — no new models found.');
    process.exit(0);
  }
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
