// Simple JSON file store for settings, API keys, aliases, conversations
// Uses electron-store when available, falls back to in-memory for dev
const path = require('path');
const fs = require('fs');
const os = require('os');

const STORE_PATH = path.join(os.homedir(), '.llmbear', 'config.json');

let data = {};

// Load from disk on startup
try {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  if (fs.existsSync(STORE_PATH)) {
    data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  }
} catch {
  data = {};
}

function save() {
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[LLM Bear] Failed to save store:', e.message);
  }
}

function get(key) {
  if (key === undefined) return { ...data };
  return data[key];
}

function set(key, value) {
  data[key] = value;
  save();
  return value;
}

function remove(key) {
  delete data[key];
  save();
}

module.exports = { get, set, remove };
