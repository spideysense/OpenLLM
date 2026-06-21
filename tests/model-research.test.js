import { describe, it, expect } from 'vitest';
import research from '../src/main/model-research.js';
const { verifyCandidate, buildUpdatedRegistry, parseCandidates } = research;

const CAP = 60; // ultra tier GB

describe('verifyCandidate — gates out unsafe research', () => {
  const good = { model: 'qwen3.6:35b-a3b', name: 'Q', provider: 'Alibaba', approx_gb: 24, tool_support: true };
  it('accepts a valid local tool-capable model that fits', () => {
    expect(verifyCandidate(good, { tierCapGB: CAP }).ok).toBe(true);
  });
  it('rejects cloud-only models', () => {
    expect(verifyCandidate({ ...good, model: 'glm-5.2:cloud' }, { tierCapGB: CAP }).ok).toBe(false);
  });
  it('rejects coder models (not chat models)', () => {
    expect(verifyCandidate({ ...good, model: 'qwen2.5-coder:32b' }, { tierCapGB: CAP }).ok).toBe(false);
  });
  it('rejects models with no tool support', () => {
    expect(verifyCandidate({ ...good, tool_support: false }, { tierCapGB: CAP }).ok).toBe(false);
  });
  it('rejects models too big for the hardware tier', () => {
    expect(verifyCandidate({ ...good, approx_gb: 400 }, { tierCapGB: CAP }).ok).toBe(false);
  });
  it('rejects a hallucinated / malformed tag', () => {
    expect(verifyCandidate({ ...good, model: 'the best model ever' }, { tierCapGB: CAP }).ok).toBe(false);
  });
});

describe('parseCandidates — defensive JSON extraction', () => {
  it('parses a clean array', () => {
    expect(parseCandidates('[{"model":"a:b"}]')).toEqual([{ model: 'a:b' }]);
  });
  it('strips code fences and surrounding prose', () => {
    const raw = 'Sure! Here:\n```json\n[{"model":"a:b"}]\n```\nHope that helps';
    expect(parseCandidates(raw)).toEqual([{ model: 'a:b' }]);
  });
  it('returns [] on garbage', () => {
    expect(parseCandidates('not json at all')).toEqual([]);
  });
});

describe('buildUpdatedRegistry — fresh rankings, safe deprecation', () => {
  const cur = {
    schema_version: 3,
    models: [
      { model: 'oldbest:32b', name: 'Old Best', min_tier: 'heavy', tool_support: true },
      { model: 'qwen3:14b', name: 'Q14', min_tier: 'medium', tool_support: true },
    ],
  };
  const verified = [
    { model: 'newbest:30b-a3b', name: 'New Best', provider: 'X', approx_gb: 22, tool_support: true, why: 'top' },
  ];

  it('puts the researched best at #1', () => {
    const reg = buildUpdatedRegistry(cur, verified);
    expect(reg.models[0].model).toBe('newbest:30b-a3b');
  });
  it('deprecates the previous best and records the successor', () => {
    const reg = buildUpdatedRegistry(cur, verified);
    const old = reg.models.find((m) => m.model === 'oldbest:32b');
    expect(old.deprecated).toBe(true);
    expect(old.superseded_by).toBe('newbest:30b-a3b');
  });
  it('keeps unrelated models as fallbacks', () => {
    const reg = buildUpdatedRegistry(cur, verified);
    expect(reg.models.some((m) => m.model === 'qwen3:14b' && !m.deprecated)).toBe(true);
  });
  it('does NOT deprecate the previous best if it is still the researched #1', () => {
    const sameTop = [{ model: 'oldbest:32b', name: 'Old Best', approx_gb: 20, tool_support: true }];
    const reg = buildUpdatedRegistry(cur, sameTop);
    const old = reg.models.find((m) => m.model === 'oldbest:32b');
    expect(old.deprecated).toBeFalsy();
  });
});
