#!/usr/bin/env node
// scripts/model-bench.js — compare local models on SPEED and intrinsic QUALITY,
// through the Ollama already running on the box (127.0.0.1:11434). Zero deps.
//
// Why: on unified-memory hardware (DGX Spark / Mac), generation speed is bound by
// memory bandwidth, so the only way to know the real speed/quality trade for YOUR
// box is to measure it. This does that: tok/s + first-token latency per model,
// plus every answer saved side-by-side so you can judge quality yourself.
//
// Usage:
//   node scripts/model-bench.js                         # default 3-model compare
//   node scripts/model-bench.js gpt-oss:120b qwen3.5    # custom list
//
// Models must already be pulled. To pull one:
//   curl http://127.0.0.1:11434/api/pull -d '{"name":"gpt-oss:120b"}'

const http = require('http');
const fs = require('fs');
const os = require('os');

const MODELS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['qwen3.6:35b-a3b', 'qwen3-coder:30b'];

// A small spread: raw speed, reasoning, coding (for the daughter's use case),
// and strict instruction-following (proxy for how well it obeys the agent rules).
const PROMPTS = [
  { label: 'Speed (200-word explainer)', prompt: 'Write a clear 200-word explanation of how a bill becomes law in the United States.' },
  { label: 'Reasoning', prompt: 'A bat and a ball cost $1.10 total. The bat costs $1.00 more than the ball. How much does the ball cost? Show your reasoning step by step, then give the final answer.' },
  { label: 'Coding', prompt: 'Write a Python function that returns the nth Fibonacci number using memoization. Include a docstring and one example call. Return only the code.' },
  { label: 'Coding (harder)', prompt: 'Write a Python class LRUCache with get(key) and put(key, value) both O(1), using a dict plus a doubly linked list. Include a short docstring and handle the capacity-eviction case. Return only the code.' },
  { label: 'Instruction-following', prompt: 'Reply with exactly three bullet points, each starting with a capital letter and ending with a period, naming three uses for a paperclip. No preamble, no other text.' },
];

function req(path, payload) {
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const r = http.request(
      { hostname: '127.0.0.1', port: 11434, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, body: d })); }
    );
    r.on('error', reject);
    r.write(body); r.end();
  });
}

async function isPulled(model) {
  try { const r = await req('/api/show', { name: model }); return r.status === 200; } catch { return false; }
}

async function generate(model, prompt) {
  const r = await req('/api/generate', { model, prompt, stream: false, options: { num_ctx: 8192 } });
  return JSON.parse(r.body);
}

(async () => {
  const answers = [];
  const table = [];
  for (const model of MODELS) {
    if (!(await isPulled(model))) {
      console.log(`\n⚠️  ${model} — not pulled. Pull with:\n    curl http://127.0.0.1:11434/api/pull -d '{"name":"${model}"}'`);
      table.push({ model, note: 'not pulled' });
      continue;
    }
    console.log(`\n=== ${model} ===`);
    const tpsList = [];
    const pfList = [];
    for (const p of PROMPTS) {
      process.stdout.write(`  ${p.label} … `);
      let r;
      try { r = await generate(model, p.prompt); } catch (e) { console.log('ERROR', e.message); continue; }
      const tps = r.eval_count && r.eval_duration ? r.eval_count / (r.eval_duration / 1e9) : 0;
      const prefillMs = r.prompt_eval_duration ? r.prompt_eval_duration / 1e6 : 0;
      tpsList.push(tps); pfList.push(prefillMs);
      console.log(`${tps.toFixed(1)} tok/s · first-token ~${prefillMs.toFixed(0)}ms`);
      answers.push(`\n### ${model} — ${p.label}  (${tps.toFixed(1)} tok/s)\n\n${(r.response || '').trim()}\n`);
    }
    const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    table.push({ model, tps: avg(tpsList).toFixed(1), prefill: avg(pfList).toFixed(0) });
  }

  console.log('\n\n=== SUMMARY (avg across prompts) ===');
  console.log('model'.padEnd(26) + 'tok/s'.padStart(9) + 'prefill(ms)'.padStart(14));
  for (const row of table) {
    if (row.note) console.log(row.model.padEnd(26) + row.note.padStart(9));
    else console.log(row.model.padEnd(26) + String(row.tps).padStart(9) + String(row.prefill).padStart(14));
  }
  console.log('\nRule of thumb: >30 tok/s feels live for chat. Pick the SMARTEST model that');
  console.log('stays above your comfort threshold — read the answers to judge "smartest".');

  const out = os.homedir() + '/aspen-model-bench.md';
  fs.writeFileSync(out, `# Aspen model bench — ${new Date().toISOString()}\n\nSpeed is tok/s (higher = faster). Read the answers below side by side to judge quality.\n${answers.join('\n')}`);
  console.log(`\nAll answers saved for side-by-side quality review: ${out}`);
})().catch((e) => { console.error('bench failed:', e.message); process.exit(1); });
