/**
 * Tests for: fast-path speed gate, owner/guest keys, world-model sync.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false } }));
vi.mock('electron-store', () => ({ default: class { get() {} set() {} } }));
vi.mock('child_process', () => ({ execSync: vi.fn(() => ''), execFileSync: vi.fn(() => '') }));
vi.mock('http', () => ({ request: vi.fn(() => ({ write: vi.fn(), end: vi.fn(), on: vi.fn(), setTimeout: vi.fn(), destroy: vi.fn() })) }));

describe('Fast-path speed gate', () => {
  it('gateway-agent has messageNeedsTools heuristic', () => {
    const src = fs.readFileSync(path.resolve('src/main/gateway-agent.js'), 'utf8');
    expect(src).toContain('messageNeedsTools');
    expect(src).toContain('TOOL_TRIGGERS');
  });
  it('has a fast path that streams without the agent loop', () => {
    const src = fs.readFileSync(path.resolve('src/main/gateway-agent.js'), 'utf8');
    expect(src).toContain('FAST PATH');
    expect(src).toContain('ollamaStream');
  });
  it('only enters tool loop when needsTools is true', () => {
    const src = fs.readFileSync(path.resolve('src/main/gateway-agent.js'), 'utf8');
    expect(src).toContain('if (!needsTools)');
  });
  it('tool triggers cover web search, weather, stock, compute, computer use', () => {
    const src = fs.readFileSync(path.resolve('src/main/gateway-agent.js'), 'utf8');
    expect(src).toContain('stock');
    expect(src).toContain('weather');
    expect(src).toContain('screenshot');
    expect(src).toContain('calculate');
  });
  it('gateway content case streams deltas without artificial word delay', () => {
    const src = fs.readFileSync(path.resolve('src/main/gateway.js'), 'utf8');
    // The old word-by-word setTimeout(20) loop must be gone from the content case
    expect(src).toContain('already token/delta-sized');
  });
});

describe('Owner vs Guest keys', () => {
  it('createKey accepts owner option', () => {
    const src = fs.readFileSync(path.resolve('src/main/index.js'), 'utf8');
    expect(src).toContain("apikeys.createKey(label, { owner");
  });
  it('preload passes owner opts', () => {
    const src = fs.readFileSync(path.resolve('src/preload/index.js'), 'utf8');
    expect(src).toContain("create: (label, opts)");
  });
  it('API Keys page has owner/member/guest radio', () => {
    const src = fs.readFileSync(path.resolve('src/renderer/pages/APIKeys.jsx'), 'utf8');
    expect(src).toContain('newKeyType');
    expect(src).toContain('Owner key');
    expect(src).toContain('Family / member');
    expect(src).toContain('guest key');
  });
  it('API Keys page explains permissions for each type', () => {
    const src = fs.readFileSync(path.resolve('src/renderer/pages/APIKeys.jsx'), 'utf8');
    expect(src).toContain('computer use');
    expect(src).toMatch(/shared memory|World Model/);
  });
  it('key list shows owner/guest badge', () => {
    const src = fs.readFileSync(path.resolve('src/renderer/pages/APIKeys.jsx'), 'utf8');
    expect(src).toContain('key.owner');
    expect(src).toMatch(/Owner|Guest/);
  });
});

describe('World Model sync (per-key)', () => {
  it('gateway has /v1/world-model route', () => {
    const src = fs.readFileSync(path.resolve('src/main/gateway.js'), 'utf8');
    expect(src).toContain("'/v1/world-model'");
  });
  it('world-model route resolves per-key memory', () => {
    const src = fs.readFileSync(path.resolve('src/main/gateway.js'), 'utf8');
    expect(src).toMatch(/world-model[\s\S]{0,400}memoryKeyFor/);
  });
  it('anonymous keys get empty facts and hasMemory:false', () => {
    const src = fs.readFileSync(path.resolve('src/main/gateway.js'), 'utf8');
    expect(src).toContain('hasMemory: false');
  });
  it('api/world-model.js proxy exists', () => {
    expect(fs.existsSync(path.resolve('api/world-model.js'))).toBe(true);
  });
  it('proxy routes to /v1/world-model', () => {
    const src = fs.readFileSync(path.resolve('api/world-model.js'), 'utf8');
    expect(src).toContain('/v1/world-model');
  });
  it('web app fetches /api/world-model and handles hasMemory:false', () => {
    const src = fs.readFileSync(path.resolve('site/app/index.html'), 'utf8');
    expect(src).toContain('/api/world-model');
    expect(src).toContain('hasMemory');
  });
});

describe('Browsing/shopping triggers route to tool path', () => {
  it('"open amazon.com" triggers tools', () => {
    const src = fs.readFileSync(path.resolve('src/main/gateway-agent.js'), 'utf8');
    // The open-website regex must handle bare domains like amazon.com
    expect(src).toMatch(/open\|go to\|navigate to\|visit\|browse/);
  });
  it('"buy a skateboard" triggers tools', () => {
    const src = fs.readFileSync(path.resolve('src/main/gateway-agent.js'), 'utf8');
    expect(src).toMatch(/buy\|shop\|order\|purchase/);
  });
});

describe('Speed optimizations', () => {
  it('keep_alive keeps model resident (gateway-agent)', () => {
    const src = fs.readFileSync(path.resolve('src/main/gateway-agent.js'), 'utf8');
    expect(src).toContain('KEEP_ALIVE');
    expect(src).toContain('keep_alive: KEEP_ALIVE');
  });
  it('keep_alive set on direct gateway streaming', () => {
    const src = fs.readFileSync(path.resolve('src/main/gateway.js'), 'utf8');
    expect(src).toContain('keep_alive = -1');
  });
  it('context is a single stable value so the model stays resident (no reload churn)', () => {
    const src = fs.readFileSync(path.resolve('src/main/gateway-agent.js'), 'utf8');
    expect(src).toContain('contextFor');
    // Must NOT vary context by message length — that unloaded/reloaded the model
    // every time the bucket changed. One fixed value, shared with all other paths.
    expect(src).not.toContain('buckets');
    expect(src).toMatch(/function contextFor[\s\S]{0,800}return system\.getRecommendedContext\(\)/);
  });
  it('background fact extraction matches chat options so it does not evict the model', () => {
    const wm = fs.readFileSync(path.resolve('src/main/world-model.js'), 'utf8');
    expect(wm).toContain('keep_alive: -1');
    expect(wm).toContain('num_ctx: system.getRecommendedContext()');
  });
  it('gateway warms the model on start', () => {
    const src = fs.readFileSync(path.resolve('src/main/gateway.js'), 'utf8');
    expect(src).toContain('Warmed model');
  });
});

describe('Brevity', () => {
  it('fast directive instructs concise/TLDR', () => {
    const src = fs.readFileSync(path.resolve('src/main/gateway-agent.js'), 'utf8');
    expect(src).toContain('BE CONCISE');
    expect(src).toMatch(/TL;DR/);
  });
  it('no preamble instruction present', () => {
    const src = fs.readFileSync(path.resolve('src/main/gateway-agent.js'), 'utf8');
    expect(src).toContain('No preamble');
  });
});
