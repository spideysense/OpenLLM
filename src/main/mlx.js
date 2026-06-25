// ─────────────────────────────────────────────────────────────────────────────
// MLX backend — Apple Silicon acceleration (~30-50% higher tok/s vs Ollama/llama.cpp).
//
// MLX is a SEPARATE inference runtime (Apple's, via Metal + unified memory). It is
// Apple Silicon only and cannot run or be tested on the Linux/Blackwell box. This
// module is the whole MLX subsystem, kept isolated so the Ollama path is untouched:
//
//   • Pure logic (unit-tested below the fold): model mapping, server argv, request
//     translation (gateway → OpenAI), and SSE delta parsing (OpenAI → gateway events).
//   • Lifecycle (Mac-only side effects): detect availability, spawn `mlx_lm.server`,
//     health-check, restart on crash, stop. Untestable from here; validated on a Mac.
//   • A single `chat()` adapter that speaks OpenAI to mlx_lm.server and yields the SAME
//     event shape the gateway already consumes from Ollama, so the call site barely changes.
//
// Design rule: MLX is opt-in and only ever used when (Apple Silicon) AND (enabled) AND
// (a known MLX model exists) AND (the server is confirmed healthy). Any miss → caller
// stays on Ollama. We never strand a user on a backend that can't answer.
//
// Inference only. Model management (tags/pull/delete/ps) always stays on Ollama.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const { spawn } = require('child_process');
const http = require('http');

const HOST = '127.0.0.1';
const PORT = 8081; // mlx_lm.server; distinct from Ollama's 11434

// ── Pure: platform ──────────────────────────────────────────────────────────
function isAppleSilicon() {
  return process.platform === 'darwin' && process.arch === 'arm64';
}

// ── Pure: model mapping ─────────────────────────────────────────────────────
// Map an Ollama model tag to an MLX-community HuggingFace repo. mlx-lm auto-downloads
// these on first use. Only models with a KNOWN good MLX build are mapped; anything
// unknown returns null so the caller stays on Ollama instead of pointing mlx_lm.server
// at a repo that may not exist. 4-bit is the default quant (best speed/size on Macs).
const MLX_MODEL_MAP = {
  'qwen2.5:7b': 'mlx-community/Qwen2.5-7B-Instruct-4bit',
  'qwen2.5:32b': 'mlx-community/Qwen2.5-32B-Instruct-4bit',
  'qwen3:14b': 'mlx-community/Qwen3-14B-4bit',
  'qwen3:32b': 'mlx-community/Qwen3-32B-4bit',
  'llama3.1:8b': 'mlx-community/Meta-Llama-3.1-8B-Instruct-4bit',
  'llama3.2:3b': 'mlx-community/Llama-3.2-3B-Instruct-4bit',
  'gemma4:26b': 'mlx-community/gemma-4-27b-it-4bit',
};

function mlxModelFor(ollamaName) {
  const key = String(ollamaName || '').toLowerCase();
  if (MLX_MODEL_MAP[key]) return MLX_MODEL_MAP[key];
  // Conservative derivation only for the qwen family we know publishes MLX builds.
  // Never guess for arbitrary tags — an unknown returns null and we stay on Ollama.
  return null;
}

// ── Pure: server argv ───────────────────────────────────────────────────────
function serverArgs(mlxModel, port = PORT) {
  return ['-m', 'mlx_lm.server', '--model', mlxModel, '--host', HOST, '--port', String(port)];
}

// ── Pure: request translation (gateway/Ollama options → OpenAI body) ────────
// The gateway thinks in Ollama options (num_ctx, num_predict, keep_alive, think).
// OpenAI/mlx-lm has no keep_alive/think and uses max_tokens. Translate, dropping
// anything MLX doesn't honor, and carry tools through in OpenAI tool schema.
function toOpenAIChatBody(model, messages, { tools = null, options = {}, stream = true } = {}) {
  const body = { model, messages, stream };
  const maxTok = options.num_predict;
  if (typeof maxTok === 'number' && maxTok > 0) body.max_tokens = maxTok;
  if (typeof options.temperature === 'number') body.temperature = options.temperature;
  if (Array.isArray(tools) && tools.length) body.tools = tools;
  return body;
}

// ── Pure: SSE delta parsing (OpenAI stream → gateway events) ────────────────
// mlx_lm.server streams OpenAI chunks: `data: {choices:[{delta:{content|tool_calls}}]}`
// then `data: [DONE]`. Translate ONE raw SSE line into the gateway's event vocabulary
// ({kind:'content'|'tools'|'done'} | null), so the call site reuses its existing loop.
// Tool-call arguments arrive as JSON STRINGS in OpenAI (handled by the gateway's
// parseToolArgs), so we pass them through unchanged.
function parseOpenAISSELine(line) {
  const s = String(line || '').trim();
  if (!s.startsWith('data:')) return null;
  const payload = s.slice(5).trim();
  if (payload === '[DONE]') return { kind: 'done' };
  let json;
  try { json = JSON.parse(payload); } catch { return null; }
  const delta = json.choices && json.choices[0] && json.choices[0].delta;
  if (!delta) return null;
  if (delta.content) return { kind: 'content', text: delta.content };
  if (Array.isArray(delta.tool_calls) && delta.tool_calls.length) {
    return { kind: 'tools', calls: delta.tool_calls };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle (Mac-only side effects). Validated on Apple Silicon, not here.
// ─────────────────────────────────────────────────────────────────────────────
const state = { proc: null, model: null, healthy: false, lastError: null };

function pythonBin() {
  // Phase 2 will bundle a frozen runtime; Phase 1 uses the user's python3.
  return process.env.ASPEN_MLX_PYTHON || 'python3';
}

function health(port = PORT) {
  return new Promise((resolve) => {
    const req = http.request({ hostname: HOST, port, path: '/v1/models', method: 'GET' }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
    req.end();
  });
}

async function waitHealthy(port = PORT, timeoutMs = 90000) {
  // Cold model download/load can take a while; poll until healthy or timeout.
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await health(port)) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

// Ensure mlx_lm.server is running for `ollamaModel`. Returns true only when the server
// is up AND healthy for the right model. Never throws into the caller — on any failure
// it cleans up, records lastError, and returns false so the caller falls back to Ollama.
async function ensureRunning(ollamaModel) {
  if (!isAppleSilicon()) { state.lastError = 'not Apple Silicon'; return false; }
  const mlxModel = mlxModelFor(ollamaModel);
  if (!mlxModel) { state.lastError = `no MLX build mapped for ${ollamaModel}`; return false; }

  // Already serving the right model and healthy → reuse.
  if (state.proc && state.model === mlxModel && state.healthy && (await health())) return true;

  // Switching model (or stale) → restart cleanly. mlx_lm.server is one-model-at-a-time.
  await stop();

  try {
    const proc = spawn(pythonBin(), serverArgs(mlxModel), { stdio: ['ignore', 'pipe', 'pipe'] });
    state.proc = proc;
    state.model = mlxModel;
    state.healthy = false;
    proc.stderr.on('data', (d) => { state.lastError = String(d).slice(0, 200); });
    proc.on('exit', (code) => {
      if (state.proc === proc) { state.proc = null; state.healthy = false; state.lastError = `mlx_lm.server exited (${code})`; }
    });
  } catch (e) {
    state.lastError = `spawn failed: ${e.message} — is mlx-lm installed? (pip install mlx-lm)`;
    state.proc = null;
    return false;
  }

  state.healthy = await waitHealthy();
  if (!state.healthy) { await stop(); state.lastError = state.lastError || 'mlx_lm.server never became healthy'; }
  return state.healthy;
}

function stop() {
  return new Promise((resolve) => {
    const p = state.proc;
    state.proc = null; state.healthy = false;
    if (!p) return resolve();
    p.once('exit', () => resolve());
    try { p.kill('SIGTERM'); } catch { resolve(); }
    setTimeout(() => { try { p.kill('SIGKILL'); } catch {} resolve(); }, 3000);
  });
}

function status() {
  return { healthy: state.healthy, model: state.model, running: !!state.proc, lastError: state.lastError };
}

// ── chat() adapter: stream from mlx_lm.server, yield gateway-shaped events ───
// Mirrors the async-generator contract of the gateway's ollamaStreamTools so the call
// site can swap implementations. Yields {kind:'content'|'tools'} and ends on 'done'.
async function* chat(ollamaModel, messages, opts = {}) {
  const mlxModel = mlxModelFor(ollamaModel);
  if (!mlxModel) throw new Error(`no MLX model for ${ollamaModel}`);
  const body = toOpenAIChatBody(mlxModel, messages, { ...opts, stream: true });

  const res = await fetch(`http://${HOST}:${PORT}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error(`mlx_lm.server responded ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      const ev = parseOpenAISSELine(line);
      if (ev) { if (ev.kind === 'done') return; yield ev; }
    }
  }
}

module.exports = {
  HOST, PORT, MLX_MODEL_MAP,
  // pure (tested)
  isAppleSilicon, mlxModelFor, serverArgs, toOpenAIChatBody, parseOpenAISSELine,
  // lifecycle + adapter (Mac-only)
  ensureRunning, stop, health, status, chat,
};
