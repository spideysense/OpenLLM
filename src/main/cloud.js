// cloud.js — the single entry the chat path calls. Default mode is BOOST: cloud
// NEVER fires unless the user explicitly asks for it (a per-request flag/header)
// or has turned on AUTO fallback. Off entirely if no provider key is set.
//
// Modes (CLOUD_MODE / user setting):
//   'off'   — never use cloud
//   'boost' — cloud only on an explicit per-request boost (DEFAULT)
//   'auto'  — boost, PLUS auto-escalate when the local model fails/declines
const { routeToCloud } = require('./cloud-router');
const { configured } = require('./cloud-providers');

let mode = (process.env.CLOUD_MODE || 'boost').toLowerCase();
const getMode = () => mode;
const setMode = (m) => { if (['off', 'boost', 'auto'].includes(m)) mode = m; return mode; };
const enabled = () => mode !== 'off' && configured().length > 0;

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

module.exports = { getMode, setMode, enabled, boost, autoFallback, configuredProviders: configured };
