// backend.js — single source of truth for which local inference backend the gateway
// talks to. Default is Ollama (llama.cpp). On Apple Silicon, an MLX backend can be
// enabled for ~30-50% higher throughput (see docs/MLX.md).
//
// STATUS: foundation / Phase 0. This module is intentionally INERT — it is not yet
// wired into the OLLAMA_HOST/OLLAMA_PORT references in gateway.js, gateway-agent.js,
// world-model.js, or models.js. Wiring it in, plus the MLX server lifecycle, must be
// built and tested on real Apple Silicon. Until then the live app is unchanged.

const OLLAMA = { host: '127.0.0.1', port: 11434, kind: 'ollama' };
const MLX = { host: '127.0.0.1', port: 8081, kind: 'mlx' };

let mlx = null;
try { mlx = require('./mlx'); } catch { mlx = null; }

// True only on M-series Macs (where MLX/Metal applies). Mirrors the platform/arch
// check already used in tunnel.js.
function isAppleSilicon() {
  return process.platform === 'darwin' && process.arch === 'arm64';
}

// Resolve the active backend upstream.
//   pref       : 'ollama' | 'mlx' | 'auto'   (user setting; default 'ollama')
//   mlxHealthy : caller must confirm mlx_lm.server is up before trusting MLX
//
// MLX is chosen ONLY when explicitly preferred (or 'auto'), AND on Apple Silicon,
// AND the MLX server is confirmed healthy. Any uncertainty falls back to Ollama,
// which is always safe. This guarantees we never route a user into a dead backend.
function resolveBackend({ pref = 'ollama', mlxHealthy = false } = {}) {
  const wantsMlx = pref === 'mlx' || pref === 'auto';
  if (wantsMlx && isAppleSilicon() && mlxHealthy) return MLX;
  return OLLAMA;
}

// INFERENCE-only resolver, the one the chat path should use. Reads live MLX health
// from the lifecycle manager. CRITICAL: only chat/generate ever routes to MLX —
// model management (tags/pull/delete/ps) has no MLX equivalent and ALWAYS uses Ollama.
function inferenceBackend(pref = 'ollama') {
  const mlxHealthy = !!(mlx && mlx.status && mlx.status().healthy);
  return resolveBackend({ pref, mlxHealthy });
}

// Management endpoints are never MLX. Explicit so call sites read clearly.
function managementBackend() {
  return OLLAMA;
}

module.exports = { OLLAMA, MLX, isAppleSilicon, resolveBackend, inferenceBackend, managementBackend };
