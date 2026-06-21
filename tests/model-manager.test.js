import { describe, it, expect } from 'vitest';
import mgr from '../src/main/model-manager.js';
import registry from '../src/main/registry.js';
import router from '../src/main/model-router.js';
const { decideChatModel } = router;

const REG = {
  models: [
    { model: 'qwen3.6:35b-a3b', min_tier: 'heavy', tool_support: true },
    { model: 'llama4:scout', min_tier: 'ultra', deprecated: true, superseded_by: 'qwen3.6:35b-a3b' },
    { model: 'qwen3:32b', min_tier: 'heavy' },
  ],
};

describe('registry quality (deprecation aware)', () => {
  it('skips deprecated models when recommending', () => {
    const runnable = registry.modelsForTier(REG, 'ultra').map((m) => m.model);
    expect(runnable).not.toContain('llama4:scout');
    expect(runnable[0]).toBe('qwen3.6:35b-a3b');
  });
  it('ranks deprecated models to the bottom', () => {
    expect(registry.qualityRank(REG, 'qwen3.6:35b-a3b')).toBeLessThan(registry.qualityRank(REG, 'llama4:scout'));
  });
  it('lists scout as retirable when its replacement is installed', () => {
    const installed = [{ name: 'llama4:scout' }, { name: 'qwen3.6:35b-a3b' }];
    expect(registry.retirableModels(REG, installed).map((r) => r.model)).toContain('llama4:scout');
  });
  it('does NOT retire scout if the replacement is not installed', () => {
    const installed = [{ name: 'llama4:scout' }];
    expect(registry.retirableModels(REG, installed)).toHaveLength(0);
  });
});

describe('router picks best chat model by quality, not size', () => {
  const list = [
    { name: 'llama4:scout', size: 68e9 },        // biggest but deprecated
    { name: 'qwen3.6:35b-a3b', size: 24e9 },     // best, smaller
    { name: 'qwen2.5-coder:32b', size: 20e9 },   // coder, excluded
  ];
  const rank = (n) => registry.qualityRank(REG, n);
  it('with a quality rank, never resurrects the bigger deprecated model', () => {
    const got = decideChatModel({ requested: 'qwen2.5-coder:32b', list, rank });
    expect(got).toBe('qwen3.6:35b-a3b');
  });
  it('without a rank, falls back to largest non-coder (legacy behavior)', () => {
    const got = decideChatModel({ requested: 'qwen2.5-coder:32b', list });
    expect(got).toBe('llama4:scout');
  });
});

describe('model-manager memory reconciliation', () => {
  const installed = [{ name: 'qwen3.6:35b-a3b' }, { name: 'qwen2.5-coder:32b' }, { name: 'llama4:scout' }];
  it('keeps the active chat model and the coder resident', () => {
    const keep = mgr.keepSet('qwen3.6:35b-a3b', installed);
    expect(keep.has('qwen3.6')).toBe(true);
    expect(keep.has('qwen2.5-coder')).toBe(true);
  });
  it('evicts a resident model that is neither active nor the coder', () => {
    const resident = [{ name: 'qwen3.6:35b-a3b' }, { name: 'llama4:scout' }];
    expect(mgr.toEvict('qwen3.6:35b-a3b', installed, resident)).toEqual(['llama4:scout']);
  });
  it('never evicts the active model', () => {
    const resident = [{ name: 'qwen3.6:35b-a3b' }];
    expect(mgr.toEvict('qwen3.6:35b-a3b', installed, resident)).toEqual([]);
  });
  it('never retires a model that is currently resident', () => {
    const resident = [{ name: 'llama4:scout' }];   // scout still loaded
    expect(mgr.toRetire(REG, installed, resident, 'qwen3.6:35b-a3b')).toEqual([]);
  });
  it('never retires the active model even if marked deprecated', () => {
    const resident = [];
    expect(mgr.toRetire(REG, installed, resident, 'llama4:scout')).toEqual([]);
  });
  it('retires a deprecated, non-resident model whose replacement is installed', () => {
    const resident = [{ name: 'qwen3.6:35b-a3b' }];
    expect(mgr.toRetire(REG, installed, resident, 'qwen3.6:35b-a3b')).toEqual(['llama4:scout']);
  });
});

describe('pickActiveModel — migrate off deprecated models', () => {
  const installed = [{ name: 'qwen3.6:35b-a3b' }, { name: 'llama4:scout' }, { name: 'qwen3:32b' }];
  it('migrates off a deprecated active model to the best installed', () => {
    expect(mgr.pickActiveModel({ current: 'llama4:scout', installed, reg: REG })).toBe('qwen3.6:35b-a3b');
  });
  it('respects a valid non-deprecated active choice', () => {
    expect(mgr.pickActiveModel({ current: 'qwen3:32b', installed, reg: REG })).toBe('qwen3:32b');
  });
  it('picks a best when none is set', () => {
    expect(mgr.pickActiveModel({ current: '', installed, reg: REG })).toBe('qwen3.6:35b-a3b');
  });
  it('keeps current if no non-deprecated model is installed', () => {
    const only = [{ name: 'llama4:scout' }];
    expect(mgr.pickActiveModel({ current: 'llama4:scout', installed: only, reg: REG })).toBe('llama4:scout');
  });
});

describe('lean mode — keep only active + coder', () => {
  const installed = [
    { name: 'qwen3.6:35b-a3b' }, { name: 'qwen2.5-coder:32b' },
    { name: 'qwen3:32b' }, { name: 'gpt-oss:120b' }, { name: 'llama4:scout' },
  ];
  it('retires every non-active, non-coder model', () => {
    const out = mgr.toRetireLean('qwen3.6:35b-a3b', installed, []);
    expect(out.sort()).toEqual(['gpt-oss:120b', 'llama4:scout', 'qwen3:32b']);
  });
  it('keeps the active model and the coder', () => {
    const out = mgr.toRetireLean('qwen3.6:35b-a3b', installed, []);
    expect(out).not.toContain('qwen3.6:35b-a3b');
    expect(out).not.toContain('qwen2.5-coder:32b');
  });
  it('never retires a model that is still resident', () => {
    const out = mgr.toRetireLean('qwen3.6:35b-a3b', installed, [{ name: 'gpt-oss:120b' }]);
    expect(out).not.toContain('gpt-oss:120b');
  });
});
