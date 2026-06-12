/**
 * Per-key memory isolation tests.
 * Each API key (owner, named members, anonymous) gets isolated memory.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// world-model.js uses require('./store') (CommonJS). Mocking that inner require
// from an ESM test is unreliable in vitest, so we use the REAL store (in-memory
// in tests) and clear each user's slice through world-model's own clearMemory,
// which uses the same store instance world-model reads/writes.
vi.mock('http', () => ({ request: vi.fn(() => ({ write: vi.fn(), end: vi.fn(), on: vi.fn(), setTimeout: vi.fn(), destroy: vi.fn() })) }));

const store = await import('../../src/main/store.js');
const worldModel = await import('../../src/main/world-model.js');
const apikeys = await import('../../src/main/apikeys.js');

function resetStore() {
  worldModel.clearMemory('owner');
  worldModel.clearMemory('ashini-id');
  worldModel.clearMemory('anjali-id');
  store.remove('apikeys');
}

describe('World Model — per-key isolation', () => {
  beforeEach(() => { resetStore(); });

  it('owner memory stored at legacy key for back-compat', () => {
    worldModel.mergeFacts(['User name is Mayank'], 'owner');
    expect(worldModel.storeKeyFor('owner')).toBe('worldModel');
    expect(worldModel.getFacts('owner')).toContain('User name is Mayank');
  });

  it('undefined keyId resolves to owner (desktop back-compat)', () => {
    worldModel.mergeFacts(['Desktop fact'], undefined);
    expect(worldModel.getFacts(undefined)).toContain('Desktop fact');
    expect(worldModel.getFacts('owner')).toContain('Desktop fact');
  });

  it('named keys get separate memory slices', () => {
    worldModel.mergeFacts(['Ashini likes hiking'], 'ashini-id');
    worldModel.mergeFacts(['Anjali plays piano'], 'anjali-id');
    expect(worldModel.getFacts('ashini-id')).toContain('Ashini likes hiking');
    expect(worldModel.getFacts('ashini-id')).not.toContain('Anjali plays piano');
    expect(worldModel.getFacts('anjali-id')).toContain('Anjali plays piano');
  });

  it('one user cannot see another user memory', () => {
    worldModel.mergeFacts(['Secret about Ashini'], 'ashini-id');
    expect(worldModel.getFacts('anjali-id')).toHaveLength(0);
    expect(worldModel.getFacts('owner')).toHaveLength(0);
  });

  it('anonymous key (null) stores nothing', () => {
    const added = worldModel.mergeFacts(['Should not persist'], null);
    expect(added).toBe(0);
    expect(worldModel.getFacts(null)).toHaveLength(0);
  });

  it('storeKeyFor maps identities correctly', () => {
    expect(worldModel.storeKeyFor('owner')).toBe('worldModel');
    expect(worldModel.storeKeyFor(undefined)).toBe('worldModel');
    expect(worldModel.storeKeyFor('abc-123')).toBe('worldModel:abc-123');
    expect(worldModel.storeKeyFor(null)).toBe(null);
  });

  it('getSystemPrefix is empty for anonymous', () => {
    worldModel.mergeFacts(['x is y'], null);
    expect(worldModel.getSystemPrefix(null)).toBe('');
  });

  it('getSystemPrefix includes facts for a named key', () => {
    worldModel.mergeFacts(['Ashini is 12 years old'], 'ashini-id');
    const prefix = worldModel.getSystemPrefix('ashini-id');
    expect(prefix).toContain('Ashini is 12 years old');
  });
});

describe('API key memory resolution', () => {
  beforeEach(() => { resetStore(); });

  it('owner key resolves to "owner" memory', () => {
    const k = apikeys.createKey('Default', { owner: true });
    expect(apikeys.memoryKeyFor(k.secret)).toBe('owner');
  });

  it('named member key resolves to its own id', () => {
    const k = apikeys.createKey('Ashini', { memory: true });
    expect(apikeys.memoryKeyFor(k.secret)).toBe(k.id);
  });

  it('anonymous guest key resolves to null (no memory)', () => {
    const k = apikeys.createKey('Public', { owner: false, memory: false });
    expect(apikeys.memoryKeyFor(k.secret)).toBe(null);
  });

  it('owner key always has memory even if memory:false passed', () => {
    const k = apikeys.createKey('Owner', { owner: true, memory: false });
    expect(k.memory).toBe(true);
  });

  it('unknown token resolves to null', () => {
    apikeys.createKey('Something', { owner: true });
    expect(apikeys.memoryKeyFor('sk-aspen-notreal')).toBe(null);
  });

  it('computer use stays owner-only (named members are not owners)', () => {
    const member = apikeys.createKey('Ashini', { memory: true });
    expect(apikeys.isOwnerKey(member.secret)).toBe(false);
  });
});

describe('Integration wiring', () => {
  it('gateway passes memoryKeyId to agent', () => {
    const src = fs.readFileSync(path.resolve('src/main/gateway.js'), 'utf8');
    expect(src).toContain('memoryKeyFor(authToken)');
    expect(src).toContain('memoryKeyId');
  });

  it('gateway-agent injects per-user memory and extracts to it', () => {
    const src = fs.readFileSync(path.resolve('src/main/gateway-agent.js'), 'utf8');
    expect(src).toContain('worldModel.getSystemPrefix(memoryKeyId)');
    expect(src).toContain('extractFacts(model');
    expect(src).toContain('memoryKeyId');
  });

  it('world-model route returns caller own memory', () => {
    const src = fs.readFileSync(path.resolve('src/main/gateway.js'), 'utf8');
    expect(src).toContain('memoryKeyFor(authToken)');
    expect(src).toContain('hasMemory');
  });

  it('API Keys UI has three key types', () => {
    const src = fs.readFileSync(path.resolve('src/renderer/pages/APIKeys.jsx'), 'utf8');
    expect(src).toContain("'named'");
    expect(src).toContain('Family / member');
    expect(src).toContain('own private memory');
  });
});
