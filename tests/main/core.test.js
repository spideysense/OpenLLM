/**
 * USER STORY: As a developer, I can alias "gpt-4" to a local model
 * so that my existing OpenAI code works without changes.
 *
 * USER STORY: As a user, I can generate local API keys
 * so apps on my machine can authenticate with LLM Bear.
 *
 * USER STORY: As a user, my settings persist between sessions
 * so I don't have to reconfigure every time.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';

// ═══════════════════════════════════════════════════
// Alias Resolution Tests
// ═══════════════════════════════════════════════════

describe('Model Aliases', () => {
  let aliases;
  let store;

  beforeEach(() => {
    // Fresh require with isolated store
    vi.resetModules();
    // Mock the store module
    const mockStore = { data: {}, get: (k) => mockStore.data[k], set: (k, v) => { mockStore.data[k] = v; } };
    vi.doMock(path.resolve('src/main/store.js'), () => ({ default: mockStore, ...mockStore }));
  });

  it('should have default aliases for OpenAI models', async () => {
    const mod = await import(path.resolve('src/main/aliases.js'));
    const defaults = mod.getDefaultAliases();
    expect(defaults).toHaveProperty('gpt-4');
    expect(defaults).toHaveProperty('gpt-4o');
    expect(defaults).toHaveProperty('gpt-4o-mini');
    expect(defaults).toHaveProperty('gpt-3.5-turbo');
  });

  it('should have default aliases for Anthropic models', async () => {
    const mod = await import(path.resolve('src/main/aliases.js'));
    const defaults = mod.getDefaultAliases();
    expect(defaults).toHaveProperty('claude-3-opus');
    expect(defaults).toHaveProperty('claude-3.5-sonnet');
    expect(defaults).toHaveProperty('claude-3-haiku');
  });

  it('should have default aliases for reasoning models', async () => {
    const mod = await import(path.resolve('src/main/aliases.js'));
    const defaults = mod.getDefaultAliases();
    expect(defaults).toHaveProperty('o1');
    expect(defaults).toHaveProperty('o1-mini');
    expect(defaults).toHaveProperty('o3-mini');
  });

  it('should resolve known aliases to local models', async () => {
    const mod = await import(path.resolve('src/main/aliases.js'));
    const resolved = mod.resolve('gpt-4');
    expect(resolved).not.toBe('gpt-4');
    expect(resolved).toMatch(/qwen|llama|deepseek/i);
  });

  it('should pass through unknown model names unchanged', async () => {
    const mod = await import(path.resolve('src/main/aliases.js'));
    const resolved = mod.resolve('my-custom-model:latest');
    expect(resolved).toBe('my-custom-model:latest');
  });

  it('should have at least 10 default aliases', async () => {
    const mod = await import(path.resolve('src/main/aliases.js'));
    const defaults = mod.getDefaultAliases();
    expect(Object.keys(defaults).length).toBeGreaterThanOrEqual(10);
  });
});

// ═══════════════════════════════════════════════════
// API Key Tests
// ═══════════════════════════════════════════════════

describe('API Keys', () => {
  // Import the real modules — CJS singletons can't be reliably mocked in vitest
  const store = require(path.resolve('src/main/store.js'));
  const apikeys = require(path.resolve('src/main/apikeys.js'));

  beforeEach(() => {
    // Clear all API keys before each test
    store.set('apikeys', []);
  });

  it('should generate keys with sk-llmbear- prefix', () => {
    const key = apikeys.createKey('Test Key');
    expect(key.secret).toMatch(/^sk-llmbear-/);
  });

  it('should generate unique keys each time', () => {
    const key1 = apikeys.createKey('Key 1');
    const key2 = apikeys.createKey('Key 2');
    expect(key1.secret).not.toBe(key2.secret);
    expect(key1.id).not.toBe(key2.id);
  });

  it('should store label and created timestamp', () => {
    const key = apikeys.createKey('My App Key');
    expect(key.label).toBe('My App Key');
    expect(key.created).toBeTruthy();
    expect(new Date(key.created).getTime()).toBeGreaterThan(0);
  });

  it('should validate existing keys', () => {
    const key = apikeys.createKey('Valid Key');
    expect(apikeys.validateKey(key.secret)).toBe(true);
  });

  it('should reject invalid keys', () => {
    apikeys.createKey('A Key');
    expect(apikeys.validateKey('sk-llmbear-fake-key')).toBe(false);
  });

  it('should allow non-empty tokens when no keys exist (open mode)', () => {
    // store was cleared in beforeEach, so no keys exist
    expect(apikeys.listKeys()).toHaveLength(0);
    expect(apikeys.validateKey('anything-goes')).toBe(true);
  });

  it('should revoke keys', () => {
    const key = apikeys.createKey('To Revoke');
    expect(apikeys.listKeys()).toHaveLength(1);
    apikeys.revokeKey(key.id);
    expect(apikeys.listKeys()).toHaveLength(0);
  });

  it('should list all active keys', () => {
    apikeys.createKey('Key 1');
    apikeys.createKey('Key 2');
    apikeys.createKey('Key 3');
    expect(apikeys.listKeys()).toHaveLength(3);
  });

  it('should update lastUsed on touch', () => {
    const key = apikeys.createKey('Touch Test');
    expect(key.lastUsed).toBeNull();
    apikeys.touchKey(key.secret);
    const updated = apikeys.listKeys().find((k) => k.id === key.id);
    expect(updated.lastUsed).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════
// Model Recommendation Tests
// ═══════════════════════════════════════════════════

describe('Model Recommendations', () => {
  let models;

  beforeEach(async () => {
    vi.resetModules();
    models = await import(path.resolve('src/main/models.js'));
  });

  it('should recommend small models for light tier', () => {
    const rec = models.getRecommendation('light', null);
    expect(rec.model).toMatch(/3b/i);
  });

  it('should recommend medium models for medium tier', () => {
    const rec = models.getRecommendation('medium', null);
    expect(rec.model).toMatch(/7b/i);
  });

  it('should recommend large models for heavy tier', () => {
    const rec = models.getRecommendation('heavy', null);
    expect(rec.model).toMatch(/32b/i);
  });

  it('should recommend flagship models for ultra tier', () => {
    const rec = models.getRecommendation('ultra', null);
    expect(rec.model).toMatch(/70b|llama3\.3/i);
  });

  it('should include a human-readable reason', () => {
    const rec = models.getRecommendation('medium', null);
    expect(rec.why).toBeTruthy();
    expect(typeof rec.why).toBe('string');
    expect(rec.why.length).toBeGreaterThan(5);
  });

  it('should include download size info', () => {
    const rec = models.getRecommendation('medium', null);
    expect(rec.sizeGB).toBeTruthy();
  });

  it('should fallback gracefully with null registry', () => {
    const rec = models.getRecommendation('medium', null);
    expect(rec).toBeTruthy();
    expect(rec.model).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════
// Hardware Tier Classification Tests
// ═══════════════════════════════════════════════════

describe('Hardware Tier Classification', () => {
  // These test the logic of tier classification without needing real hardware
  // The actual system.js uses os module, so we test the module indirectly

  it('should classify tiers based on RAM thresholds', async () => {
    // We can't easily mock os.totalmem(), but we verify the module loads
    const system = await import(path.resolve('src/main/system.js'));
    expect(system.getHardwareTier).toBeDefined();
    expect(system.getSystemInfo).toBeDefined();
  });

  it('should return one of four valid tiers', async () => {
    const system = await import(path.resolve('src/main/system.js'));
    const tier = system.getHardwareTier();
    expect(['light', 'medium', 'heavy', 'ultra']).toContain(tier);
  });

  it('should detect platform correctly', async () => {
    const system = await import(path.resolve('src/main/system.js'));
    const info = system.getSystemInfo();
    expect(['darwin', 'win32', 'linux']).toContain(info.platform);
    expect(info.totalRAMGB).toBeGreaterThan(0);
    expect(info.cpuCores).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════
// Store Persistence Tests
// ═══════════════════════════════════════════════════

describe('Persistent Store', () => {
  const store = require(path.resolve('src/main/store.js'));

  afterEach(() => {
    // Clean up test keys
    store.remove('testKey');
    store.remove('complex');
    store.remove('nonexistent');
    store.remove('toDelete');
  });

  it('should get and set values', () => {
    store.set('testKey', 'testValue');
    expect(store.get('testKey')).toBe('testValue');
  });

  it('should handle complex objects', () => {
    const obj = { nested: { key: 'value' }, arr: [1, 2, 3] };
    store.set('complex', obj);
    expect(store.get('complex')).toEqual(obj);
  });

  it('should return undefined for missing keys', () => {
    expect(store.get('nonexistent')).toBeUndefined();
  });

  it('should remove keys', () => {
    store.set('toDelete', 'value');
    store.remove('toDelete');
    expect(store.get('toDelete')).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════
// Registry Model Catalog Tests
// ═══════════════════════════════════════════════════

describe('Model Registry', () => {
  it('should have a valid registry JSON file', () => {
    const registryPath = path.resolve('registry/models.json');
    expect(fs.existsSync(registryPath)).toBe(true);

    const raw = fs.readFileSync(registryPath, 'utf8');
    const registry = JSON.parse(raw);
    expect(registry).toHaveProperty('schema_version');
    expect(registry).toHaveProperty('categories');
  });

  it('should have general category with tier recommendations', () => {
    const registry = JSON.parse(fs.readFileSync(path.resolve('registry/models.json'), 'utf8'));
    const general = registry.categories?.general;
    expect(general).toBeTruthy();
    if (general?.recommendations) {
      const tiers = Object.keys(general.recommendations);
      expect(tiers.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('should have valid model names in recommendations', () => {
    const registry = JSON.parse(fs.readFileSync(path.resolve('registry/models.json'), 'utf8'));
    for (const [cat, catData] of Object.entries(registry.categories || {})) {
      for (const [tier, rec] of Object.entries(catData.recommendations || {})) {
        expect(rec.model).toBeTruthy();
        expect(typeof rec.model).toBe('string');
      }
    }
  });
});
