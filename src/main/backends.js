// ─────────────────────────────────────────────────────────────────────────────
// Backend registry — WHERE a model runs.
//
// model-router.js already answers "which model?" across models on this box. This
// answers the other axis: which machine. Three kinds, deliberately ordered:
//
//   local  this box's Ollama          free · private · default, always
//   peer   another Aspen you own      free · private · stays in the house
//   cloud  a provider you keyed       costs money · LEAVES THE MACHINE
//
// Privacy is a first-class field here, not a footnote. Every backend declares
// whether a prompt leaves the machine, so the router can prefer the ones that
// don't and the UI can say plainly when one doesn't.
//
// Two rules this module exists to enforce:
//   1. Cloud is NEVER a silent fallback. Nothing here auto-selects a cloud
//      backend; the caller has to ask for it by id.
//   2. Keys are the user's and stay on the user's disk. We never ship a key
//      anywhere except to the provider it belongs to, straight from the box.
//
// Leaf module: depends only on `store` + global fetch, so it can't create a
// require cycle (same discipline as model-router.js).
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const store = require('./store');

const STORE_KEY = 'backends';

const KIND = { LOCAL: 'local', PEER: 'peer', CLOUD: 'cloud' };

// How far a prompt travels. The router sorts on this before anything else.
const PRIVACY = {
  MACHINE: 'machine', // never leaves this computer
  HOUSE: 'house',     // goes to hardware the user owns, over their own tunnel
  LEAVES: 'leaves',   // goes to a third party
};

const LOCAL_ID = 'local';

// Every one of these speaks the OpenAI /chat/completions dialect. That single
// fact is why supporting "everything" is cheap: one adapter, many providers.
// Adding a provider is a line here, not a new integration.
const CLOUD_PRESETS = {
  openai:     { label: 'OpenAI',     baseUrl: 'https://api.openai.com/v1' },
  anthropic:  { label: 'Anthropic',  baseUrl: 'https://api.anthropic.com/v1' },
  groq:       { label: 'Groq',       baseUrl: 'https://api.groq.com/openai/v1' },
  together:   { label: 'Together',   baseUrl: 'https://api.together.xyz/v1' },
  fireworks:  { label: 'Fireworks',  baseUrl: 'https://api.fireworks.ai/inference/v1' },
  deepseek:   { label: 'DeepSeek',   baseUrl: 'https://api.deepseek.com/v1' },
  mistral:    { label: 'Mistral',    baseUrl: 'https://api.mistral.ai/v1' },
  xai:        { label: 'xAI',        baseUrl: 'https://api.x.ai/v1' },
  custom:     { label: 'Custom',     baseUrl: '' }, // any OpenAI-compatible URL
};

/** The box itself. Always present, always first, can't be removed. */
function localBackend() {
  return {
    id: LOCAL_ID,
    kind: KIND.LOCAL,
    label: 'This Aspen',
    privacy: PRIVACY.MACHINE,
    baseUrl: 'http://127.0.0.1:11434',
    cost: 0,
    removable: false,
  };
}

function readStored() {
  try {
    const raw = store.get(STORE_KEY);
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeStored(list) {
  try { store.set(STORE_KEY, list); return true; } catch { return false; }
}

/**
 * All backends, local first, then house, then cloud. The order IS the policy:
 * callers that just take the first workable one land on the private option.
 */
function list() {
  const rank = { [PRIVACY.MACHINE]: 0, [PRIVACY.HOUSE]: 1, [PRIVACY.LEAVES]: 2 };
  return [localBackend(), ...readStored()].sort(
    (a, b) => (rank[a.privacy] ?? 9) - (rank[b.privacy] ?? 9)
  );
}

function get(id) {
  return list().find((b) => b.id === id) || null;
}

/** Backends that never send a prompt off this machine. */
function privateOnly() {
  return list().filter((b) => b.privacy === PRIVACY.MACHINE);
}

/** True if using this backend means the prompt leaves the user's machine. */
function leavesMachine(id) {
  const b = get(id);
  return !!b && b.privacy !== PRIVACY.MACHINE;
}

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

function uniqueId(base, taken) {
  let id = base || 'backend';
  let n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  return id;
}

/**
 * Add a cloud backend using the user's OWN key.
 *
 * The key is written to local config and sent only to that provider, directly
 * from this box — it never passes through any Aspen server, because there is no
 * Aspen server in this path.
 */
function addCloud({ provider, apiKey, label, baseUrl, models } = {}) {
  const preset = CLOUD_PRESETS[provider];
  if (!preset) return { error: `Unknown provider "${provider}".` };
  const key = String(apiKey || '').trim();
  if (!key) return { error: 'An API key is required.' };
  const url = String(baseUrl || preset.baseUrl || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(url)) return { error: 'A provider needs an https base URL.' };

  const stored = readStored();
  const taken = new Set([LOCAL_ID, ...stored.map((b) => b.id)]);
  const entry = {
    id: uniqueId(slug(label || provider), taken),
    kind: KIND.CLOUD,
    label: String(label || preset.label),
    provider,
    privacy: PRIVACY.LEAVES,
    baseUrl: url,
    apiKey: key,
    models: Array.isArray(models) ? models : [],
    removable: true,
    addedAt: Date.now(),
  };
  stored.push(entry);
  if (!writeStored(stored)) return { error: 'Could not save the backend.' };
  return { ok: true, backend: redact(entry) };
}

/**
 * Add another Aspen you own (the GB10 in the study, the family box). Reuses the
 * tunnel + scoped key that QR pairing already mints, so the prompt goes to your
 * own hardware and never leaves the house.
 */
function addPeer({ label, tunnelUrl, apiKey } = {}) {
  const url = String(tunnelUrl || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) return { error: 'A peer needs its Aspen URL.' };
  const stored = readStored();
  const taken = new Set([LOCAL_ID, ...stored.map((b) => b.id)]);
  const entry = {
    id: uniqueId(slug(label || 'aspen'), taken),
    kind: KIND.PEER,
    label: String(label || 'My other Aspen'),
    privacy: PRIVACY.HOUSE,
    baseUrl: url,
    apiKey: String(apiKey || '').trim(),
    cost: 0,
    removable: true,
    addedAt: Date.now(),
  };
  stored.push(entry);
  if (!writeStored(stored)) return { error: 'Could not save the backend.' };
  return { ok: true, backend: redact(entry) };
}

function remove(id) {
  if (id === LOCAL_ID) return { error: 'This Aspen cannot be removed.' };
  const stored = readStored();
  const next = stored.filter((b) => b.id !== id);
  if (next.length === stored.length) return { error: 'No such backend.' };
  if (!writeStored(next)) return { error: 'Could not save.' };
  return { ok: true };
}

/** Never hand an API key back to the renderer — it has no reason to see one. */
function redact(b) {
  if (!b) return b;
  const { apiKey, ...rest } = b;
  return { ...rest, hasKey: !!apiKey };
}

function listSafe() {
  return list().map(redact);
}

/**
 * "backendId/model" -> { backend, model }. A bare model name means local, which
 * keeps every existing caller working untouched and makes local the default by
 * construction rather than by convention.
 */
function resolve(ref) {
  const s = String(ref || '').trim();
  if (!s) return { backend: localBackend(), model: '' };
  const i = s.indexOf('/');
  if (i > 0) {
    const b = get(s.slice(0, i));
    if (b) return { backend: b, model: s.slice(i + 1) };
  }
  return { backend: localBackend(), model: s };
}

/** Ask a cloud/peer backend what models it serves (OpenAI-compatible /models). */
async function fetchModels(id, { timeoutMs = 10000 } = {}) {
  const b = get(id);
  if (!b) return { error: 'No such backend.' };
  if (b.kind === KIND.LOCAL) return { error: 'Use the local model list for this Aspen.' };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${b.baseUrl}/models`, {
      headers: b.apiKey ? { Authorization: `Bearer ${b.apiKey}` } : {},
      signal: ctrl.signal,
    });
    if (!res.ok) return { error: `${b.label} returned ${res.status}.` };
    const json = await res.json();
    const models = (json.data || json.models || [])
      .map((m) => (typeof m === 'string' ? m : m.id || m.name))
      .filter(Boolean);
    return { ok: true, models };
  } catch (e) {
    return { error: `Could not reach ${b.label}: ${e.message}` };
  } finally {
    clearTimeout(t);
  }
}

module.exports = {
  KIND, PRIVACY, CLOUD_PRESETS, LOCAL_ID,
  list, listSafe, get, remove, resolve, redact,
  addCloud, addPeer, fetchModels,
  privateOnly, leavesMachine, localBackend,
};
