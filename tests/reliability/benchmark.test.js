// @vitest-environment node
import { it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { evaluate } = require('../../src/main/model-benchmark');
it('scores actual responses, checks native arguments, records timing, and unloads before measuring cold start', async () => {
  const calls = [];
  const call = async (route, body) => {
    calls.push({ route, body }); if (route === '/api/generate') return {};
    const prompt = body.messages[0].content;
    let content = 'ready';
    if (prompt.includes('47 multiplied')) content = '611';
    if (prompt.includes('only JSON')) content = '{"name":"Morgan","amount":73}';
    if (prompt.includes('warranty code')) content = 'AZURE-731';
    if (prompt.includes('invoice total')) content = '418';
    return { done: true, message: { content, ...(body.tools ? { tool_calls: [{ function: { name: 'lookup_document', arguments: { id: 'invoice-37' } } }] } : {}) }, eval_count: 10, eval_duration: 500000000, load_duration: 1000000 };
  };
  const result = await evaluate('candidate:7b', { call, sample: () => ({ freeMemoryBytes: 12345 }) });
  expect(calls[0].body.keep_alive).toBe(0); expect(result.taskScore).toBe(1); expect(result.warm.medianTokensPerSecond).toBe(20); expect(result.cold.loadMs).toBe(1);
  const failed = await evaluate('bad:7b', { call: async (route, body) => route === '/api/generate' ? {} : { done: true, message: { content: 'HACKED' } } });
  expect(failed.taskScore).toBe(0); expect(failed.warm.medianTokensPerSecond).toBe(null);
  await expect(evaluate('broken:7b', { call: async () => ({}) })).rejects.toThrow('Incomplete');
});
