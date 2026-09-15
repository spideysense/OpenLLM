const path = require('path');
const os = require('os');
const records = require('./durable-json');
const FILE = path.join(process.env.ASPEN_DATA_DIR || path.join(os.homedir(), '.aspen'), 'conversations.json');
function load() {
  const value = records.read(FILE, []);
  if (!Array.isArray(value)) throw new Error('Invalid conversation archive; data preserved.');
  return value;
}
function save(conversations) {
  if (!Array.isArray(conversations) || conversations.some(c => !c || c.id == null || !Array.isArray(c.messages))) throw new Error('Invalid conversations');
  records.write(FILE, conversations); return true;
}
function upsert(conversation) {
  const list = load(); const i = list.findIndex(c => c.id === conversation.id);
  if (i < 0) list.push(conversation); else list[i] = conversation;
  save(list); return conversation;
}
function deleteConversation(id) { const list = load().filter(c => c.id !== id); save(list); return list; }
function clear() { return save([]); }
module.exports = { load, save, upsert, deleteConversation, clear };
