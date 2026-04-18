/**
 * Monet Conversation Persistence
 *
 * Saves chat history to disk so conversations survive app restarts.
 * Stored as JSON in ~/.monet/conversations.json
 * Max 50 conversations, each capped at 200 messages.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const MONET_DIR = path.join(os.homedir(), '.monet');
const FILE = path.join(MONET_DIR, 'conversations.json');
const MAX_CONVOS = 50;
const MAX_MESSAGES = 200;

function ensureDir() {
  fs.mkdirSync(MONET_DIR, { recursive: true });
}

function load() {
  try {
    ensureDir();
    if (!fs.existsSync(FILE)) return [];
    const raw = fs.readFileSync(FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function save(conversations) {
  try {
    ensureDir();
    // Trim to limits before saving
    const trimmed = conversations
      .slice(-MAX_CONVOS)
      .map((c) => ({
        ...c,
        messages: c.messages.slice(-MAX_MESSAGES),
      }));
    fs.writeFileSync(FILE, JSON.stringify(trimmed, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('[Conversations] Save failed:', err.message);
    return false;
  }
}

function deleteConversation(id) {
  const convos = load();
  const filtered = convos.filter((c) => c.id !== id);
  save(filtered);
  return filtered;
}

function clear() {
  try {
    fs.writeFileSync(FILE, '[]', 'utf8');
    return true;
  } catch {
    return false;
  }
}

module.exports = { load, save, deleteConversation, clear };
