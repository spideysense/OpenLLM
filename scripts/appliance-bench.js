#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/appliance-bench.js — decide the 235B question with numbers, not debate.
//
// Runs a head-to-head battery against the Ollama already on the box
// (127.0.0.1:11434), on the axes that actually decide Aspen's appliance design:
//   1. Warm decode speed (tok/s) + first-token latency
//   2. Prompt-processing (prefill) speed — matters most at long context
//   3. Long-context: 64K + 128K needle-in-haystack (correctness + speed + does it OOM)
//   4. Coding accuracy — code is executed and checked, not eyeballed
//   5. Tool-calling reliability — % of runs that emit a valid tool call
//   6. Memory footprint (resident + VRAM) via /api/ps
//   7. Multi-model residency — can it stay loaded ALONGSIDE the coder, or evict it?
//   8. Concurrency — aggregate tok/s under N parallel requests
//
// Zero deps. Talks straight to Ollama. Saves a JSON + a markdown table.
//
// USAGE
//   node scripts/appliance-bench.js                          # candidate vs champion (defaults)
//   node scripts/appliance-bench.js --candidate qwen3-235b-iq3 --champion qwen3.6:35b-a3b --coder qwen3-coder:30b
//   node scripts/appliance-bench.js --quick                  # skip 128K + concurrency (fast pass)
//
// SETUP — the candidate must be pulled/imported into Ollama first.
// Qwen3-235B-A22B isn't a stock Ollama tag; import an IQ3 GGUF from unsloth:
//   1) Download (e.g.) Qwen3-235B-A22B-Instruct-2507-UD-IQ3_XXS from
//      huggingface.co/unsloth/Qwen3-235B-A22B-Instruct-2507-GGUF  (~90-103 GB)
//   2) Create a Modelfile:   printf 'FROM /path/to/model.gguf\n' > Modelfile
//   3) ollama create qwen3-235b-iq3 -f Modelfile
// Then pass --candidate qwen3-235b-iq3.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

// ── args ──────────────────────────────────────────────────────────────────────
function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def;
}
const QUICK = process.argv.includes('--quick');
const CANDIDATE = arg('candidate', 'qwen3-235b-iq3');
const CHAMPION = arg('champion', 'qwen3.6:35b-a3b');
const CODER = arg('coder', 'qwen3-coder:30b');
const MODELS = [CANDIDATE, CHAMPION];

// ── ollama transport ───────────────────────────────────────────────────────────
function req(method, path_, payload) {
  const body = payload ? JSON.stringify(payload) : null;
  return new Promise((resolve, reject) => {
    const r = http.request(
      { hostname: '127.0.0.1', port: 11434, path: path_, method,
        headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {} },
      (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, body: d })); }
    );
    r.on('error', reject);
    r.setTimeout(600000, () => { r.destroy(new Error('timeout (600s)')); });
    if (body) r.write(body);
    r.end();
  });
}
const post = (p, payload) => req('POST', p, payload);
const get = (p) => req('GET', p, null);

async function isPulled(model) {
  try { const r = await post('/api/show', { name: model }); return r.status === 200; } catch { return false; }
}
async function ps() {
  try { const r = await get('/api/ps'); return JSON.parse(r.body).models || []; } catch { return []; }
}
const GB = (bytes) => (bytes / 1e9).toFixed(1);

// One non-streaming generate. Returns Ollama's precise ns timings + text.
// keepAlive:-1 pins the model (needed for residency tests); num_ctx sizes KV cache.
async function gen(model, prompt, { num_ctx = 8192, keepAlive = 0, num_predict = 512 } = {}) {
  const t0 = Date.now();
  const r = await post('/api/generate', {
    model, prompt, stream: false, keep_alive: keepAlive,
    options: { num_ctx, num_predict },
  });
  const wall = Date.now() - t0;
  let j; try { j = JSON.parse(r.body); } catch { return { error: `bad response (${r.status}): ${r.body.slice(0, 200)}`, wall }; }
  if (j.error) return { error: j.error, wall };
  const decodeToksPerSec = j.eval_count && j.eval_duration ? (j.eval_count / (j.eval_duration / 1e9)) : 0;
  const prefillToksPerSec = j.prompt_eval_count && j.prompt_eval_duration ? (j.prompt_eval_count / (j.prompt_eval_duration / 1e9)) : 0;
  // TTFT ≈ load + prompt-eval (prefill) time; on a warm model load≈0.
  const ttftMs = ((j.load_duration || 0) + (j.prompt_eval_duration || 0)) / 1e6;
  return {
    text: j.response || '', wall,
    promptTokens: j.prompt_eval_count || 0, outTokens: j.eval_count || 0,
    decodeToksPerSec, prefillToksPerSec, ttftMs,
    loadMs: (j.load_duration || 0) / 1e6,
  };
}

// ── long-context needle prompt ──────────────────────────────────────────────────
// ~4 chars/token. Put a needle near the top, ask for it at the end → tests prefill
// speed AND retrieval AND whether the KV cache for this ctx even fits.
function needlePrompt(approxTokens) {
  const NEEDLE = 'The secret passphrase is BLUE-WOMBAT-42.';
  const filler = 'The quick brown fox jumps over the lazy dog. ';
  const targetChars = approxTokens * 4;
  const reps = Math.max(1, Math.floor(targetChars / filler.length));
  const body = NEEDLE + ' ' + filler.repeat(reps);
  return body + '\n\nQuestion: What is the secret passphrase? Answer with ONLY the passphrase, nothing else.';
}
const needleOK = (text) => /BLUE-WOMBAT-42/.test(text || '');

// ── coding: execute + check ─────────────────────────────────────────────────────
const CODING = [
  { prompt: 'Write a Python function fib(n) returning the nth Fibonacci number (fib(0)=0, fib(1)=1). Return ONLY the code, no markdown fences, no explanation.',
    test: 'print(fib(10))', expect: '55' },
  { prompt: 'Write a Python function is_palindrome(s) that returns True if s reads the same forwards and backwards ignoring case and non-alphanumerics. Return ONLY the code.',
    test: "print(is_palindrome('A man, a plan, a canal: Panama'))", expect: 'True' },
];
function stripFences(t) {
  const m = (t || '').match(/```(?:python)?\s*([\s\S]*?)```/i);
  return (m ? m[1] : t || '').trim();
}
function runPython(code) {
  const tmp = path.join(os.tmpdir(), `abench_${Date.now()}_${Math.random().toString(36).slice(2)}.py`);
  try {
    fs.writeFileSync(tmp, code);
    const out = execFileSync('python3', [tmp], { timeout: 15000, encoding: 'utf8' });
    return out.trim();
  } catch (e) { return `ERROR: ${(e.stderr || e.message || '').toString().split('\n')[0]}`; }
  finally { try { fs.unlinkSync(tmp); } catch {} }
}
async function scoreCoding(model) {
  let pass = 0;
  for (const c of CODING) {
    const r = await gen(model, c.prompt, { num_ctx: 8192, num_predict: 600 });
    if (r.error) continue;
    const code = stripFences(r.text) + '\n' + c.test + '\n';
    const out = runPython(code);
    if (out === c.expect) pass++;
  }
  return { pass, total: CODING.length };
}

// ── tool-calling reliability ─────────────────────────────────────────────────────
const TOOLS = [{
  type: 'function',
  function: { name: 'get_weather', description: 'Get current weather for a city',
    parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } },
}];
async function scoreToolCalls(model, runs = 4) {
  let ok = 0;
  for (let i = 0; i < runs; i++) {
    try {
      const r = await post('/api/chat', {
        model, stream: false, keep_alive: -1, tools: TOOLS,
        messages: [{ role: 'user', content: 'What is the weather in Paris right now? Use the tool.' }],
      });
      const j = JSON.parse(r.body);
      const calls = j.message && j.message.tool_calls;
      if (Array.isArray(calls) && calls.some((c) => c.function && c.function.name === 'get_weather')) ok++;
    } catch {}
  }
  return { ok, runs };
}

// ── concurrency ──────────────────────────────────────────────────────────────────
async function concurrency(model, n = 4) {
  const p = 'Write a clear 150-word explanation of how photosynthesis works.';
  const t0 = Date.now();
  const results = await Promise.all(Array.from({ length: n }, () => gen(model, p, { num_ctx: 8192, keepAlive: -1, num_predict: 256 })));
  const wall = (Date.now() - t0) / 1000;
  const totalOut = results.reduce((s, r) => s + (r.outTokens || 0), 0);
  const errors = results.filter((r) => r.error).length;
  return { n, aggregateToksPerSec: totalOut / wall, errors };
}

// ── per-model battery ────────────────────────────────────────────────────────────
async function benchModel(model) {
  const out = { model };
  if (!(await isPulled(model))) { out.missing = true; return out; }

  // Warm the model (also captures cold-load time), pinned.
  const warm = await gen(model, 'Say hello in one word.', { num_ctx: 8192, keepAlive: -1, num_predict: 8 });
  out.coldLoadMs = warm.loadMs || 0;
  if (warm.error) { out.error = warm.error; return out; }

  // Footprint while resident.
  const running = (await ps()).find((m) => m.name === model || m.model === model);
  out.footprintGB = running ? GB(running.size || 0) : '?';
  out.vramGB = running ? GB(running.size_vram || 0) : '?';

  // Warm short-prompt speed.
  const s = await gen(model, 'Write a clear 200-word explanation of how a bill becomes law in the US.', { num_ctx: 8192, keepAlive: -1 });
  out.decodeToksPerSec = +s.decodeToksPerSec.toFixed(1);
  out.ttftMs = Math.round(s.ttftMs);

  // Long context: 64K always; 128K unless --quick. Captures prefill tok/s, needle correctness, OOM.
  out.longContext = {};
  for (const ctxK of QUICK ? [64] : [64, 128]) {
    const approx = ctxK * 1024;
    const r = await gen(model, needlePrompt(approx - 200), { num_ctx: ctxK * 1024, keepAlive: -1, num_predict: 32 });
    out.longContext[ctxK + 'K'] = r.error
      ? { error: r.error.slice(0, 120) }  // e.g. OOM at this KV cache size — a real result
      : { prefillToksPerSec: +r.prefillToksPerSec.toFixed(1), ttftSec: +(r.ttftMs / 1000).toFixed(1), needleFound: needleOK(r.text) };
  }

  out.coding = await scoreCoding(model);
  out.toolCalls = await scoreToolCalls(model);
  if (!QUICK) out.concurrency = await concurrency(model, 4);

  return out;
}

// ── multi-model residency: the appliance-defining test ───────────────────────────
// Aspen keeps several models warm at once. Can the candidate stay resident ALONGSIDE
// the coder, or does loading it evict everything?
async function residency(primary) {
  if (!(await isPulled(primary)) || !(await isPulled(CODER))) return { skipped: 'primary or coder not pulled' };
  await gen(primary, 'hi', { keepAlive: -1, num_predict: 4 });
  await gen(CODER, 'hi', { keepAlive: -1, num_predict: 4 });
  const running = await ps();
  const names = running.map((m) => m.name || m.model);
  const totalGB = GB(running.reduce((s, m) => s + (m.size || 0), 0));
  return {
    coResident: names.includes(primary) && names.includes(CODER),
    loaded: names, totalGB,
  };
}

// ── run + report ─────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\nAppliance bench — candidate=${CANDIDATE} vs champion=${CHAMPION}${QUICK ? ' (quick)' : ''}\n`);
  const results = [];
  for (const m of MODELS) {
    process.stdout.write(`  benching ${m} … `);
    const r = await benchModel(m);
    results.push(r);
    console.log(r.missing ? 'NOT PULLED (skipped)' : r.error ? `ERROR: ${r.error.slice(0, 80)}` : 'done');
  }

  console.log(`\n  residency: ${CANDIDATE} + ${CODER} …`);
  const resCand = await residency(CANDIDATE);
  console.log(`  residency: ${CHAMPION} + ${CODER} …`);
  const resChamp = await residency(CHAMPION);

  const report = { date: new Date().toISOString(), host: os.hostname(), quick: QUICK, models: results,
    residency: { [CANDIDATE]: resCand, [CHAMPION]: resChamp } };

  const outDir = path.join(os.homedir(), '.aspen', 'bench');
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `appliance-bench-${Date.now()}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  // Human-readable table.
  const row = (r) => {
    if (r.missing) return `| ${r.model} | NOT PULLED | | | | | | |`;
    if (r.error) return `| ${r.model} | ERROR: ${r.error.slice(0, 40)} | | | | | | |`;
    const lc64 = r.longContext['64K'], lc128 = r.longContext['128K'];
    const lc = (x) => !x ? '—' : x.error ? 'OOM/err' : `${x.prefillToksPerSec}t/s ${x.needleFound ? '✓needle' : '✗needle'}`;
    return `| ${r.model} | ${r.decodeToksPerSec} | ${r.ttftMs}ms | ${r.footprintGB}GB | ${lc(lc64)} | ${lc(lc128)} | ${r.coding.pass}/${r.coding.total} | ${r.toolCalls.ok}/${r.toolCalls.runs}${r.concurrency ? ' | ' + r.concurrency.aggregateToksPerSec.toFixed(0) + 't/s' : ''} |`;
  };
  const md = [
    `# Appliance bench — ${new Date().toISOString().slice(0, 16)}`,
    ``,
    `Candidate: \`${CANDIDATE}\` · Champion: \`${CHAMPION}\` · Coder: \`${CODER}\`${QUICK ? ' · quick' : ''}`,
    ``,
    `| model | decode tok/s | TTFT | footprint | 64K ctx | 128K ctx | coding | tool-call${QUICK ? '' : ' | concurrency(4)'} |`,
    QUICK ? `|---|---|---|---|---|---|---|---|` : `|---|---|---|---|---|---|---|---|---|`,
    ...results.map(row),
    ``,
    `## Multi-model residency (the appliance question)`,
    `- \`${CANDIDATE}\` + \`${CODER}\` co-resident: **${resCand.coResident ? 'YES' : 'NO'}** ${resCand.skipped ? '(' + resCand.skipped + ')' : '(' + (resCand.totalGB || '?') + 'GB total, loaded: ' + (resCand.loaded || []).join(', ') + ')'}`,
    `- \`${CHAMPION}\` + \`${CODER}\` co-resident: **${resChamp.coResident ? 'YES' : 'NO'}** ${resChamp.skipped ? '(' + resChamp.skipped + ')' : '(' + (resChamp.totalGB || '?') + 'GB total, loaded: ' + (resChamp.loaded || []).join(', ') + ')'}`,
    ``,
    `## How to read this`,
    `- **decode tok/s** is the felt speed. On a bandwidth-bound box it tracks ACTIVE params, so the candidate (22B active) should be well below the champion (3B) regardless of quant.`,
    `- **128K ctx** shows whether the candidate's KV cache even fits at long context (mission/coding workloads) — "OOM/err" there is a decisive result.`,
    `- **residency NO** for the candidate means it evicts your coder/other models — i.e. it can't run in Aspen's multi-model design, only as a solo model.`,
    `- Verdict rule of thumb: the candidate has to win coding/tool-call by a margin big enough to justify the tok/s drop AND the loss of co-residency. If it can't stay resident with the coder, it's not an appliance default — at most an optional "Max Brain" mode.`,
  ].join('\n');
  const mdPath = path.join(outDir, `appliance-bench-${Date.now()}.md`);
  fs.writeFileSync(mdPath, md);

  console.log('\n' + md + '\n');
  console.log(`Saved: ${jsonPath}\n        ${mdPath}\n`);
})().catch((e) => { console.error('bench failed:', e.message); process.exit(1); });
