// @vitest-environment node
import { test, expect } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
test('readiness rejects truncated reasoning that merely mentions the expected answer', async () => {
  let answer = { done: true, done_reason: 'length', message: { content: 'The user asked for ready. I should say ready.' } };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync('src/main/model-qualification.js', 'utf8'), {
    module, AbortSignal, Date,
    fetch: async url => ({ ok: true, json: async () => url.endsWith('/api/tags') ? { models: [{ name: 'test:3b', digest: 'verified', size: 2e9 }] } : url.endsWith('/api/show') ? { capabilities: [] } : answer }),
    require: id => ({ './model-id': { normalize: value => value }, './system': { getRuntimeBudget: () => ({ memoryGB: 8 }), getRecommendedContext: () => 4096 }, './store': { get: () => ({}), set: () => {} } })[id],
  });
  expect((await module.exports.qualify('test:3b')).ok).toBe(false);
  answer = { done: true, done_reason: 'stop', message: { content: 'ready' } };
  expect((await module.exports.qualify('test:3b')).ok).toBe(true);
});
