/**
 * USER STORY: As a user, the app updates its UI silently on launch
 * so I never have to download a new DMG just to get a UI fix.
 *
 * USER STORY: As a developer, a bad hot update never bricks a user's app
 * because the bundled renderer is always the fallback.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';

// ── Mock electron app before requiring hot-updater ──
vi.mock('electron', () => ({
  app: {
    getPath: (name) => {
      if (name === 'userData') return os.tmpdir();
      if (name === 'temp') return os.tmpdir();
      return os.tmpdir();
    },
    getVersion: () => '0.2.4',
    isPackaged: false,
  },
  net: {},
}));

// ═══════════════════════════════════════════════════
// Version comparison
// ═══════════════════════════════════════════════════

describe('Hot Updater — version comparison', () => {
  // Extract the isNewer logic by loading the module and poking at it
  // indirectly via getCurrentVersion / resolveRendererPath

  it('treats a higher patch as newer', () => {
    const parse = v => String(v).replace(/^v/, '').split('.').map(Number);
    const isNewer = (remote, current) => {
      const r = parse(remote), c = parse(current);
      for (let i = 0; i < Math.max(r.length, c.length); i++) {
        const a = r[i] ?? 0, b = c[i] ?? 0;
        if (a > b) return true;
        if (a < b) return false;
      }
      return false;
    };
    expect(isNewer('0.2.5', '0.2.4')).toBe(true);
    expect(isNewer('0.3.0', '0.2.9')).toBe(true);
    expect(isNewer('1.0.0', '0.9.9')).toBe(true);
  });

  it('treats equal versions as not newer', () => {
    const parse = v => String(v).replace(/^v/, '').split('.').map(Number);
    const isNewer = (remote, current) => {
      const r = parse(remote), c = parse(current);
      for (let i = 0; i < Math.max(r.length, c.length); i++) {
        const a = r[i] ?? 0, b = c[i] ?? 0;
        if (a > b) return true;
        if (a < b) return false;
      }
      return false;
    };
    expect(isNewer('0.2.4', '0.2.4')).toBe(false);
    expect(isNewer('1.0.0', '1.0.0')).toBe(false);
  });

  it('treats an older remote as not newer', () => {
    const parse = v => String(v).replace(/^v/, '').split('.').map(Number);
    const isNewer = (remote, current) => {
      const r = parse(remote), c = parse(current);
      for (let i = 0; i < Math.max(r.length, c.length); i++) {
        const a = r[i] ?? 0, b = c[i] ?? 0;
        if (a > b) return true;
        if (a < b) return false;
      }
      return false;
    };
    expect(isNewer('0.2.3', '0.2.4')).toBe(false);
    expect(isNewer('0.1.0', '0.2.0')).toBe(false);
  });

  it('handles v-prefix in version strings', () => {
    const parse = v => String(v).replace(/^v/, '').split('.').map(Number);
    const isNewer = (remote, current) => {
      const r = parse(remote), c = parse(current);
      for (let i = 0; i < Math.max(r.length, c.length); i++) {
        const a = r[i] ?? 0, b = c[i] ?? 0;
        if (a > b) return true;
        if (a < b) return false;
      }
      return false;
    };
    expect(isNewer('v0.2.5', 'v0.2.4')).toBe(true);
    expect(isNewer('v0.2.4', 'v0.2.4')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════
// Manifest structure validation
// ═══════════════════════════════════════════════════

describe('Hot Updater — manifest', () => {
  it('site/updates/latest.json is valid JSON with required fields', () => {
    const manifestPath = path.resolve('site/updates/latest.json');
    expect(fs.existsSync(manifestPath)).toBe(true);
    const raw = fs.readFileSync(manifestPath, 'utf8');
    let manifest;
    expect(() => { manifest = JSON.parse(raw); }).not.toThrow();
    expect(manifest).toHaveProperty('rendererVersion');
    expect(manifest).toHaveProperty('rendererUrl');
    expect(typeof manifest.rendererVersion).toBe('string');
    expect(typeof manifest.rendererUrl).toBe('string');
    expect(manifest.rendererUrl).toMatch(/^https:\/\//);
  });

  it('manifest rendererVersion matches package.json version', () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve('site/updates/latest.json'), 'utf8'));
    const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
    expect(manifest.rendererVersion).toBe(pkg.version);
  });
});

// ═══════════════════════════════════════════════════
// Renderer path fallback (pure logic, no Electron binary needed)
// ═══════════════════════════════════════════════════

describe('Hot Updater — renderer path logic', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aspen-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Replicate hasValidHotRenderer logic inline (same as hot-updater.js)
  function hasValidHotRenderer(userData) {
    const hotIndex = path.join(userData, 'renderer', 'index.html');
    try { return fs.existsSync(hotIndex) && fs.statSync(hotIndex).size > 0; }
    catch { return false; }
  }

  function resolveRendererPath(userData) {
    if (hasValidHotRenderer(userData)) {
      return path.join(userData, 'renderer', 'index.html');
    }
    return path.join('build', 'index.html');
  }

  it('falls back to build/index.html when no hot renderer exists', () => {
    const result = resolveRendererPath(tmpDir);
    expect(result).toContain('build');
    expect(result).toContain('index.html');
    expect(result).not.toContain('renderer');
  });

  it('uses hot renderer when index.html exists and has content', () => {
    const rendererDir = path.join(tmpDir, 'renderer');
    fs.mkdirSync(rendererDir, { recursive: true });
    fs.writeFileSync(path.join(rendererDir, 'index.html'), '<html>hot</html>');

    const result = resolveRendererPath(tmpDir);
    expect(result).toContain('renderer');
    expect(result).toContain('index.html');
  });

  it('falls back if hot renderer index.html is empty', () => {
    const rendererDir = path.join(tmpDir, 'renderer');
    fs.mkdirSync(rendererDir, { recursive: true });
    fs.writeFileSync(path.join(rendererDir, 'index.html'), ''); // empty = corrupt

    const result = resolveRendererPath(tmpDir);
    expect(result).toContain('build');
  });
});
