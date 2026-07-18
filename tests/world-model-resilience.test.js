import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Module from 'module';

// The world-model injection was the last thing added to the gateway chat path
// (the "nice to meet you" fix). It runs on EVERY phone/web reply, so if it can
// throw, it can break plain "Hi". These tests pin that it (a) reads the right
// bucket per identity, (b) filters sensitive facts, and (c) degrades to empty
// instead of throwing when the store misbehaves.
//
// We intercept require('./store') at the loader (vi.mock doesn't take for this
// module's require-time capture), load a FRESH world-model per test, and point
// the store at an in-memory map.

const data = { map: new Map(), throws: false };
const storeStub = {
  get: (k) => { if (data.throws) throw new Error('disk gone'); return data.map.get(k); },
  set: (k, v) => { data.map.set(k, v); },
};

const realLoad = Module._load;
function installStoreStub() {
  Module._load = function (request, parent, isMain) {
    if (request === './store' || request.endsWith('/store')) return storeStub;
    if (request === './ollama' || request.endsWith('/ollama')) {
      return { chat: async () => ({ success: true, content: '[]' }) };
    }
    return realLoad.call(this, request, parent, isMain);
  };
}

function freshWorldModel() {
  const p = require.resolve('../src/main/world-model');
  delete require.cache[p];
  return require('../src/main/world-model');
}

beforeEach(() => {
  data.map = new Map();
  data.throws = false;
  installStoreStub();
});
afterEach(() => { Module._load = realLoad; });

describe('world model never breaks the reply path', () => {
  it('unknown/empty/null key yields an empty prefix, not a throw', () => {
    const wm = freshWorldModel();
    expect(wm.getSystemPrefix('nobody')).toBe('');
    expect(wm.getSystemPrefix(null)).toBe('');
    expect(wm.getSystemPrefix(undefined)).toBe('');
  });

  it('a store that THROWS on read does not propagate', () => {
    data.throws = true;
    const wm = freshWorldModel();
    expect(() => wm.getSystemPrefix('owner')).not.toThrow();
    expect(wm.getSystemPrefix('owner')).toBe('');
  });

  it('garbage in the store (not the {facts:[]} shape) is tolerated', () => {
    data.map.set('worldModel', 'not an object');
    const wm = freshWorldModel();
    expect(() => wm.getSystemPrefix('owner')).not.toThrow();
  });

  it('real facts produce a context-only prefix that says not to parrot them', () => {
    data.map.set('worldModel', { facts: ['User name is Mayank', 'User founded Gather'] });
    const wm = freshWorldModel();
    const p = wm.getSystemPrefix('owner');
    expect(p).toContain('Mayank');
    expect(p).toContain('Gather');
    expect(p.toLowerCase()).toMatch(/do not|don.t/);
  });

  it('sensitive facts are filtered out of the injected prefix', () => {
    data.map.set('worldModel', { facts: [
      'User name is Mayank',
      'User is going through a divorce',
      'User was diagnosed with anxiety',
    ] });
    const wm = freshWorldModel();
    const p = wm.getSystemPrefix('owner');
    expect(p).toContain('Mayank');
    expect(p).not.toMatch(/divorce/i);
    expect(p).not.toMatch(/anxiety/i);
  });

  it('owner and a keyed guest read different buckets', () => {
    data.map.set('worldModel', { facts: ['Owner fact'] });
    data.map.set('worldModel:guest7', { facts: ['Guest fact'] });
    const wm = freshWorldModel();
    expect(wm.getSystemPrefix('owner')).toContain('Owner fact');
    expect(wm.getSystemPrefix('owner')).not.toContain('Guest fact');
    expect(wm.getSystemPrefix('guest7')).toContain('Guest fact');
    expect(wm.getSystemPrefix('guest7')).not.toContain('Owner fact');
  });

  it('anonymous (null key) is never written to', () => {
    const wm = freshWorldModel();
    const added = wm.mergeFacts(['some fact'], null);
    expect(added).toBe(0);
    expect(data.map.get('worldModel')).toBeUndefined();
  });
});
