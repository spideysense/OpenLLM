const crypto = require('crypto');
const store = require('./store');

const KEY_PREFIX = 'sk-aspen-';

// ═══════════════════════════════════════════════════
// Key Management
// ═══════════════════════════════════════════════════

function listKeys() {
  return store.get('apikeys') || [];
}

function createKey(label = 'Default', { owner = false, memory = false, userId = null } = {}) {
  const keys = listKeys();
  const id = crypto.randomUUID();
  const secret = KEY_PREFIX + crypto.randomBytes(24).toString('base64url');
  const key = {
    id,
    label,
    userId: owner ? 'owner' : (userId || id),
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
  // Keep an owner credential available after revoking the final key.
  // Empty stores also fail closed during initialization or recovery.
  let regenerated = false;
  if (keys.length === 0) {
    const fresh = { id: crypto.randomUUID(), userId: 'owner', label: 'Default', secret: KEY_PREFIX + crypto.randomBytes(24).toString('base64url'), owner: true, memory: true, created: new Date().toISOString(), lastUsed: null };
    store.set('apikeys', [fresh]);
    return { success: true, regenerated: true, newKey: fresh };
  }
  store.set('apikeys', keys);
  return { success: true, regenerated };
}

function validateKey(token) {
  if (!token) return false;
  const keys = listKeys();
  // An empty key store never grants access.
  if (keys.length === 0) return false;
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
  // No configured identity means no memory access.
  if (keys.length === 0) return null;
  const key = keys.find(k => k.secret === token);
  if (!key) return null;
  if (key.owner) return 'owner';
  if (key.memory) return key.userId || key.id;
  return null;
}

function rotateKey(id) {
  const keys = listKeys(); const key = keys.find(k => k.id === id);
  if (!key) throw new Error('Key not found');
  key.userId = key.userId || (key.owner ? 'owner' : key.id);
  key.secret = KEY_PREFIX + crypto.randomBytes(24).toString('base64url');
  key.created = new Date().toISOString(); store.set('apikeys', keys); return key;
}
module.exports = { rotateKey, listKeys, createKey, revokeKey, validateKey, touchKey, isOwnerKey, memoryKeyFor };
