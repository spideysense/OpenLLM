// cloud.js — the single entry the chat path calls. Default mode is OFF: cloud
// NEVER fires unless the user turns it on in Settings, and even then only on an
// explicit per-request boost (or AUTO fallback if they chose that). Off entirely
// if no provider key is set. Every outbound request passes the context minimizer.
//
// Modes ('off' DEFAULT / 'boost' / 'auto') — set in the app's Settings, persisted
// in the local store; CLOUD_MODE env is only an operator override for headless use.
const { routeToCloud } = require('./cloud-router');
const { configured } = require('./cloud-providers');

let mode = (process.env.CLOUD_MODE || 'off').toLowerCase();
const getMode = () => mode;
const setMode = (m) => { if (['off', 'boost', 'auto'].includes(m)) mode = m; return mode; };
const enabled = () => mode !== 'off' && configured().length > 0;

// Pull the user's Settings (mode + provider keys) from the local store into this
// module. Called by the gateway per boost-eligible request, so Settings changes
// apply live — no restart, no extra IPC. Keys live only in the local store and
// are injected into env for cloud-providers to read; they never leave the box
// except as auth headers to the provider the user chose.
const KEY_ENV = ['GEMINI_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY', 'CEREBRAS_API_KEY', 'MISTRAL_API_KEY', 'ZHIPU_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'];
function syncFromStore() {
  try {
    const store = require('./store');
    const m = store.get('cloudMode');
    if (typeof m === 'string') setMode(m.toLowerCase());
    const keys = store.get('cloudKeys') || {};
    for (const k of KEY_ENV) {
      if (typeof keys[k] === 'string' && keys[k].trim()) process.env[k] = keys[k].trim();
    }
  } catch {}
  return mode;
}

// Explicit user boost (a button / header / {boost:true} on the request).
async function boost(messages, opts = {}) {
  if (mode === 'off' || !configured().length) return null;
  return routeToCloud(messages, opts);
}

// Auto fallback — only when mode==='auto' AND the local attempt failed/declined.
async function autoFallback(messages, { localFailed = false, ...opts } = {}) {
  if (mode !== 'auto' || !localFailed || !configured().length) return null;
  return routeToCloud(messages, opts);
}

module.exports = { getMode, setMode, enabled, boost, autoFallback, configuredProviders: configured, syncFromStore };
