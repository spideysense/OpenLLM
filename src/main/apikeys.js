const crypto = require('crypto');
const store = require('./store');

const KEY_PREFIX = 'sk-llmbear-';

// ═══════════════════════════════════════════════════
// Key Management
// ═══════════════════════════════════════════════════

function listKeys() {
  return store.get('apikeys') || [];
}

function createKey(label = 'Default') {
  const keys = listKeys();
  const id = crypto.randomUUID();
  const secret = KEY_PREFIX + crypto.randomBytes(24).toString('base64url');
  const key = {
    id,
    label,
    secret,
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
    store.set('apikeys', keys);
  }
}

module.exports = { listKeys, createKey, revokeKey, validateKey, touchKey };
