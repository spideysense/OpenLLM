const path = require('path');
const os = require('os');
const records = require('./durable-json');
const STORE_PATH = path.join(process.env.ASPEN_DATA_DIR || path.join(os.homedir(), '.aspen'), 'config.json');
let data;
function load() {
  if (data === undefined) {
    // Includes keys and replay protection. Falling back to an older copy could
    // resurrect revoked credentials. Explicit backup restore rotates them.
    const value = records.readStrict(STORE_PATH, {});
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Invalid Aspen configuration; data preserved.');
    data = value;
  }
  return data;
}
function get(key) { const value = key === undefined ? load() : load()[key]; return value === undefined ? undefined : structuredClone(value); }
function set(key, value) {
  if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Invalid setting');
  const next = { ...load(), [key]: structuredClone(value) };
  records.write(STORE_PATH, next); data = next; return value;
}
function remove(key) { const next = { ...load() }; delete next[key]; records.write(STORE_PATH, next); data = next; }
function replace(value) { records.write(STORE_PATH, value); data = structuredClone(value); }
module.exports = { get, set, remove, replace };
