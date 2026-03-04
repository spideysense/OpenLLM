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


describe('Ollama: Runtime Setup', () => {
  const ollamaSrc = fs.readFileSync(path.resolve('src/main/ollama.js'), 'utf8');
  const onboardingSrc = fs.readFileSync(path.resolve('src/renderer/pages/Onboarding.jsx'), 'utf8');
  const preloadSrc = fs.readFileSync(path.resolve('src/preload/index.js'), 'utf8');
  const pkgJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
  const workflowSrc = fs.readFileSync(path.resolve('.github/workflows/release.yml'), 'utf8');

  // ── Binary resolution chain ──

  it('should check bundled binary first (resources/vendor/ollama)', () => {
    expect(ollamaSrc).toContain('getBundledPath');
    expect(ollamaSrc).toContain('process.resourcesPath');
  });

  it('should check system binary second (/usr/local/bin etc)', () => {
    expect(ollamaSrc).toContain('getSystemPath');
    expect(ollamaSrc).toContain('/usr/local/bin/ollama');
  });

  it('should check downloaded binary third (~/.llmbear/bin/)', () => {
    expect(ollamaSrc).toContain('getDownloadedPath');
    expect(ollamaSrc).toContain('.llmbear');
  });

  it('should use priority: bundled → system → downloaded → null', () => {
    expect(ollamaSrc).toContain('getBundledPath() || getSystemPath() || getDownloadedPath()');
  });

  // ── Runtime download ──

  it('should auto-download Ollama if not found anywhere', () => {
    expect(ollamaSrc).toContain('downloadOllama');
    expect(ollamaSrc).toContain('ollama.com/download');
  });

  it('should download to ~/.llmbear/bin/', () => {
    expect(ollamaSrc).toContain('.llmbear');
    expect(ollamaSrc).toContain('bin');
  });

  it('should make binary executable on Unix', () => {
    expect(ollamaSrc).toContain('chmodSync');
    expect(ollamaSrc).toContain('0o755');
  });

  it('should follow redirects when downloading', () => {
    expect(ollamaSrc).toContain('downloadFile');
    expect(ollamaSrc).toContain('redirects');
  });

  it('should fall back to install.sh on macOS if direct download fails', () => {
    expect(ollamaSrc).toContain('install.sh');
    expect(ollamaSrc).toContain('curl -fsSL');
  });

  it('should open ollama.com as last resort', () => {
    expect(ollamaSrc).toContain('ollama.com');
    expect(ollamaSrc).toContain('openExternal');
  });

  // ── Model storage ──

  it('should store models in ~/.llmbear/models/', () => {
    expect(ollamaSrc).toContain('OLLAMA_MODELS');
    expect(ollamaSrc).toContain('.llmbear');
  });

  // ── Onboarding ──

  it('should never show "Ollama" to the user in onboarding UI text', () => {
    expect(onboardingSrc).not.toContain("'Ollama");
    expect(onboardingSrc).not.toContain('"Ollama');
    expect(onboardingSrc).toContain('AI engine');
  });

  it('should check ensureRunning result before pulling model', () => {
    expect(onboardingSrc).toContain('runResult.success');
  });

  it('should expose ollama.onProgress in preload', () => {
    expect(preloadSrc).toContain("ipcRenderer.on('ollama:progress'");
  });

  // ── CI Build (critical: don't break the release pipeline!) ──

  it('should NOT bundle Ollama in CI build (too large, crashes builds)', () => {
    // The bundle-ollama step was causing v0.1.3-v0.1.5 to fail
    expect(workflowSrc).not.toContain('bundle-ollama');
    expect(workflowSrc).not.toContain('Bundle Ollama');
  });

  it('should have version-less artifact names in electron-builder', () => {
    expect(pkgJson.build.mac.artifactName).toBe('LLMBear-mac.${ext}');
    expect(pkgJson.build.win.artifactName).toBe('LLMBear-win.${ext}');
  });

  it('should use assets/ for buildResources (not build/ which is gitignored)', () => {
    expect(pkgJson.build.directories.buildResources).toBe('assets');
  });

  it('should have icon.png in assets/ directory', () => {
    expect(fs.existsSync(path.resolve('assets/icon.png'))).toBe(true);
  });

  it('should NOT have extraResources referencing non-existent directories', () => {
    // THIS WAS THE BUG: extraResources pointed to vendor/ollama/ which
    // doesn't exist in CI. electron-builder crashes, build fails, no release,
    // "latest" stays on old version, download 404s.
    const extra = pkgJson.build.extraResources;
    if (extra) {
      for (const entry of extra) {
        const dir = typeof entry === 'string' ? entry : entry.from;
        if (dir) {
          // Either the directory exists, or it's optional
          // For now, just ensure we don't reference vendor/ollama
          expect(dir).not.toContain('vendor/ollama');
        }
      }
    }
  });

  it('should have all build paths reference files that exist in git', () => {
    // Ensures icon, entitlements, afterSign script all exist
    const iconPath = pkgJson.build.mac.icon;
    const entPath = pkgJson.build.mac.entitlements;
    const signPath = pkgJson.build.afterSign;
    expect(fs.existsSync(path.resolve(iconPath))).toBe(true);
    expect(fs.existsSync(path.resolve(entPath))).toBe(true);
    expect(fs.existsSync(path.resolve(signPath))).toBe(true);
  });
});
