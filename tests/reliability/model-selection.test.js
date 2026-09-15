// @vitest-environment node
import { test, expect } from 'vitest';
import { createRequire } from 'node:module';
const { candidates, choose } = createRequire(import.meta.url)('../../src/main/model-selection');
test('CPU shortlist bounds downloads and excludes deprecated or unsupported models', () => {
  const entry = (model, download_gb, extra = {}) => ({ model, download_gb, tool_support: true, min_tier: 'light', ...extra });
  const registry = { models: [entry('huge', 20), entry('retired', 4, { deprecated: true }), entry('no-tools', 3, { tool_support: false }), entry('fast', 5), entry('small', 2)] };
  expect(candidates('heavy', registry, { memoryGB: 40 }, false).map(m => m.model)).toEqual(['fast', 'small']);
  expect(candidates('heavy', registry, { memoryGB: 40 }, true).map(m => m.model)).toEqual(['huge', 'fast']);
});
test('selection requires quality and tool checks and prefers responsive candidates', () => {
  const r = (model, speed, quality = 1, tools = true) => ({ model, qualification: { ok: true, tools }, benchmark: { taskScore: quality, warm: { medianTokensPerSecond: speed }, tasks: [{ id: 'native-tool-call', passed: tools }] } });
  expect(choose([r('slow', 2), r('responsive', 15, 0.8)]).model).toBe('responsive');
  expect(choose([r('no-tools', 100, 1, false), r('low-quality', 100, 0.4)])).toBeNull();
});
