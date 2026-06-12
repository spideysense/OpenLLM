const crypto = require('crypto');
const store = require('./store');

const KEY_PREFIX = 'sk-aspen-';

// ═══════════════════════════════════════════════════
// Key Management
// ═══════════════════════════════════════════════════

function listKeys() {
  return store.get('apikeys') || [];
}

function createKey(label = 'Default', { owner = false, memory = false } = {}) {
  const keys = listKeys();
  const id = crypto.randomUUID();
  const secret = KEY_PREFIX + crypto.randomBytes(24).toString('base64url');
  const key = {
    id,
    label,
    secret,
    owner,
    // Owner keys always have memory. Named guest keys can opt in. Anonymous
    // keys (memory:false) get no persistent memory.
    memory: owner ? true : !!memory,
    created: new Date().toISOString(),
    lastUsed: null,
  };
  keys.push(key);
  store.set('apikeys', keys);
  return key;
}

function revokeKey(keyId) {
  let keys = listKeys();
  keys = keys.filter((k) => k.id !== keyId);
  store.set('apikeys', keys);
  return { success: true };
}

function validateKey(token) {
  if (!token) return false;
  const keys = listKeys();
  // If no keys exist, gateway runs in open mode
  if (keys.length === 0) return true;
  return keys.some((k) => k.secret === token);
}

function touchKey(token) {
  const keys = listKeys();
  const key = keys.find((k) => k.secret === token);
  if (key) {
    key.lastUsed = new Date().toISOString();
    key.usageCount = (key.usageCount || 0) + 1;
    store.set('apikeys', keys);
  }
}

function isOwnerKey(token) {
  if (!token) return false;
  const keys = listKeys();
  const key = keys.find(k => k.secret === token);
  return key?.owner === true;
}

// Resolve the memory scope for a token:
//   - owner key            → 'owner'  (the owner's shared memory)
//   - named key w/ memory  → the key's id (that user's private memory)
//   - anonymous / no memory → null  (no memory stored)
function memoryKeyFor(token) {
  if (!token) return null;
  const keys = listKeys();
  // Open mode (no keys configured) → treat as owner
  if (keys.length === 0) return 'owner';
  const key = keys.find(k => k.secret === token);
  if (!key) return null;
  if (key.owner) return 'owner';
  if (key.memory) return key.id;
  return null;
}

module.exports = { listKeys, createKey, revokeKey, validateKey, touchKey, isOwnerKey, memoryKeyFor };
