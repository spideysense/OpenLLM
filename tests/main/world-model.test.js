import { describe, it, expect } from 'vitest';
import worldModel from '../../src/main/world-model.js';

const { paramsB, storeKeyFor, SMALL_EXTRACTION_MODELS, MAX_EXTRACTION_PARAMS_B } = worldModel;

// The memory bug: extraction silently never ran because no resident model matched
// a brittle name list. Selection is now SIZE-based — these lock that in.
describe('paramsB (extraction size parsing)', () => {
  it('reads param size from /api/ps details', () => {
    expect(paramsB({ name: 'llama3.2:3b', details: { parameter_size: '3.2B' } })).toBeCloseTo(3.2);
    expect(paramsB({ name: 'foo', details: { parameter_size: '1.7B' } })).toBeCloseTo(1.7);
  });

  it('falls back to the tag when details are missing', () => {
    expect(paramsB({ name: 'llama3.2:3b' })).toBe(3);
    expect(paramsB({ name: 'qwen2.5-coder:32b' })).toBe(32);
    expect(paramsB('gemma2:2b')).toBe(2);
  });

  it('returns null when size is unknowable', () => {
    expect(paramsB({ name: 'mystery-model' })).toBeNull();
    expect(paramsB({})).toBeNull();
  });

  it('keeps small extraction models under the size cap and large chat models over it', () => {
    // A 3B extractor is eligible; a 32B coder / 109B chat model is not.
    expect(paramsB({ name: 'llama3.2:3b' })).toBeLessThanOrEqual(MAX_EXTRACTION_PARAMS_B);
    expect(paramsB({ name: 'qwen2.5-coder:32b' })).toBeGreaterThan(MAX_EXTRACTION_PARAMS_B);
  });
});

describe('extraction model list', () => {
  it('includes common small tags so the name-fallback is broad', () => {
    expect(SMALL_EXTRACTION_MODELS).toContain('llama3.2:3b');
    expect(SMALL_EXTRACTION_MODELS).toContain('llama3.2:1b');
    expect(SMALL_EXTRACTION_MODELS.length).toBeGreaterThanOrEqual(8);
  });
});

describe('storeKeyFor (memory identity)', () => {
  it('maps owner and named keys, and disables anonymous', () => {
    expect(storeKeyFor('owner')).toBe('worldModel');
    expect(storeKeyFor(undefined)).toBe('worldModel');
    expect(storeKeyFor('ashini')).toBe('worldModel:ashini');
    expect(storeKeyFor(null)).toBeNull(); // anonymous → no memory
  });
});
