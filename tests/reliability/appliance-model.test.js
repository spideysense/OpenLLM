// @vitest-environment node
import { it, expect } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
it('downloads the exact recommended tag and promotes only after qualification, carrying shutdown cancellation', async () => {
  const data = {}, calls = [], signal = new AbortController().signal;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync('src/main/appliance-model.js', 'utf8'), { module,
    require: id => ({
      './store': { get: key => data[key], set: (key,value) => { data[key] = value; } },
      './ollama': { getOllamaPath: () => '/reviewed/ollama', ensureRunning: async () => {} },
      './models': { getRecommendation: () => ({ model: 'candidate:7b' }), listModels: async () => [{ name: 'candidate:3b' }], pullModel: async (name, progress, options) => { calls.push(['pull',name]); expect(options.signal).toBe(signal); return { success: true }; } },
      './system': { getHardwareTier: () => 'medium', getRuntimeBudget: () => ({ memoryGB: 10 }), getSystemInfo: () => ({ gpu: { type: 'metal' } }), getRecommendedContext: () => 4096 },
      './model-id': { normalize: name => name },
      './model-qualification': { qualify: async (name, options) => { expect(data.activeModel).toBeUndefined(); expect(options.signal).toBe(signal); calls.push(['qualify',name]); return { ok: true, tools: true }; } },
      '../../registry/models.json': {},
      './model-selection': { candidates: () => [{ model: 'candidate:7b' }], choose: results => results[0] },
      './model-benchmark': { evaluate: async () => ({ taskScore: 1 }) },
    })[id],
  });
  await module.exports.ready({ signal }); expect(calls).toEqual([['pull','candidate:7b'],['qualify','candidate:7b'],['qualify','candidate:7b']]); expect(data.activeModel).toBe('candidate:7b'); expect(data.applianceModelStatus.state).toBe('ready');
});
