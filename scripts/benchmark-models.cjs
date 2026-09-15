#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { evaluate, request } = require('../src/main/model-benchmark');
async function main() {
  const [output, ...requested] = process.argv.slice(2);
  if (!output || !requested.length || requested.length > 8)
    throw new Error(
      'Usage: node scripts/benchmark-models.cjs report.json model:tag [model:tag ...] (up to 8 installed models). Close Aspen and other inference clients first.'
    );
  const release = await require('../src/main/profile-lock').acquire();
  const system = require('../src/main/system');
  const report = {
    version: 1,
    at: new Date().toISOString(),
    hardware: system.getSystemInfo(),
    os: { platform: os.platform(), release: os.release(), arch: os.arch() },
    context: system.getRecommendedContext(),
    cases: [],
    limitations:
      'Small deterministic task suite; not a universal intelligence score. Cold means unloaded model, not flushed OS disk cache. No physical thermals, power loss, vision or audio qualification is implied.',
  };
  let resident = [];
  try {
    resident = (await request('/api/ps')).models || [];
    const installed = (await request('/api/tags')).models || [];
    const normalize = require('../src/main/model-id').normalize;
    for (const candidate of requested) {
      const model = installed.find((m) => normalize(m.name) === normalize(candidate));
      if (!model) {
        report.cases.push({ model: candidate, error: 'Exact model tag is not installed' });
        continue;
      }
      if (model.size > system.getRuntimeBudget().memoryGB * 1e9) {
        report.cases.push({ model: candidate, error: 'Model exceeds the runtime memory budget' });
        continue;
      }
      try {
        report.cases.push({
          ...(await evaluate(model.name, { context: report.context })),
          digest: model.digest,
        });
      } catch (error) {
        report.cases.push({ model: model.name, digest: model.digest, error: error.message });
      }
      await request('/api/generate', {
        model: model.name,
        prompt: '',
        keep_alive: 0,
        stream: false,
      });
      // Checkpoint each candidate so a power failure preserves completed results.
      require('../src/main/durable-json').atomicWrite(
        path.resolve(output),
        JSON.stringify(report, null, 2)
      );
    }
    report.ranking = report.cases
      .filter((r) => !r.error)
      .sort(
        (a, b) =>
          b.taskScore - a.taskScore ||
          (b.warm.medianTokensPerSecond || 0) - (a.warm.medianTokensPerSecond || 0)
      )
      .map((r) => r.model);
    report.preferredCandidate = report.ranking[0] || null;
    require('../src/main/durable-json').atomicWrite(
      path.resolve(output),
      JSON.stringify(report, null, 2)
    );
    console.log(`Benchmark saved to ${path.resolve(output)}. Default model unchanged.`);
    if (report.cases.some((r) => r.error)) process.exitCode = 1;
  } finally {
    // Restore residency, not configuration. Report any restoration failure.
    for (const model of resident) {
      try {
        await request('/api/chat', {
          model: model.name,
          messages: [{ role: 'user', content: 'ready' }],
          stream: false,
          keep_alive: -1,
          options: { num_predict: 1, num_ctx: report.context },
        });
      } catch (e) {
        console.error(`Could not restore ${model.name}: ${e.message}`);
        process.exitCode = 1;
      }
    }
    await release();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
