const crypto = require('crypto');
const store = require('./store');

const KEY_PREFIX = 'sk-aspen-';

// ═══════════════════════════════════════════════════
// Key Management
// ═══════════════════════════════════════════════════

function listKeys() {
  return store.get('apikeys') || [];
}

function createKey(label = 'Default', { owner = false } = {}) {
  const keys = listKeys();
  const id = crypto.randomUUID();
  const secret = KEY_PREFIX + crypto.randomBytes(24).toString('base64url');
  const key = {
    id,
    label,
    secret,
    owner,
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

module.exports = { listKeys, createKey, revokeKey, validateKey, touchKey, isOwnerKey };
