/**
 * World Model engine — learns about each user from conversations.
 *
 * Memory is PER-KEY: each API key (owner, Ashini, Anjali, Anoushka...) has its
 * own isolated slice. The owner's memory lives at the legacy `worldModel` key
 * for backward compatibility; named guest keys live at `worldModel:{keyId}`.
 * Anonymous keys get no memory (keyId is null → no read/write).
 *
 * Everything stays local — facts are stored in electron-store on the Aspen
 * machine. Nothing ever leaves the device.
 */

const store = require('./store');
const http = require('http');

const OLLAMA_HOST = '127.0.0.1';
const OLLAMA_PORT = 11434;
const MAX_FACTS = 100; // Cap to keep context manageable

// Resolve the storage key for a given identity.
//   - 'owner' or undefined → legacy 'worldModel' (the owner's memory)
//   - any other keyId      → 'worldModel:{keyId}' (that user's private memory)
//   - null                 → null (anonymous, no memory)
function storeKeyFor(keyId) {
  if (keyId === null) return null;            // anonymous: no memory
  if (!keyId || keyId === 'owner') return 'worldModel';
  return `worldModel:${keyId}`;
}

/**
 * Get all known facts about a specific user (by key).
 */
function getFacts(keyId) {
  const sk = storeKeyFor(keyId);
  if (!sk) return [];
  const wm = store.get(sk) || { facts: [] };
  return wm.facts || [];
}

/**
 * Build a system prompt prefix from a user's world model.
 */
function getSystemPrefix(keyId) {
  const facts = getFacts(keyId);
  if (facts.length === 0) return '';
  return `Here is what you know about the user from past conversations (use naturally, don't list back):\n${facts.map(f => `- ${f}`).join('\n')}\n\n`;
}

/**
 * Merge new facts into a user's world model, avoiding duplicates.
 */
function mergeFacts(newFacts, keyId) {
  const sk = storeKeyFor(keyId);
  if (!sk) return 0; // anonymous: don't store anything
  const wm = store.get(sk) || { facts: [] };
  const existing = new Set((wm.facts || []).map(f => f.toLowerCase().trim()));
  const added = [];

  for (const fact of newFacts) {
    const trimmed = fact.trim();
    if (!trimmed || trimmed.length < 5) continue;
    if (existing.has(trimmed.toLowerCase())) continue;
    existing.add(trimmed.toLowerCase());
    added.push(trimmed);
  }

  if (added.length === 0) return 0;

  const allFacts = [...(wm.facts || []), ...added].slice(-MAX_FACTS);
  store.set(sk, { facts: allFacts, updatedAt: new Date().toISOString() });
  console.log(`[WorldModel:${keyId || 'owner'}] Added ${added.length} new facts`);
  return added.length;
}

/**
 * Extract facts from a conversation using the local model.
 * Runs in the background after each exchange — non-blocking.
 */
async function extractFacts(model, messages, keyId) {
  // Anonymous keys store no memory — skip extraction entirely.
  if (storeKeyFor(keyId) === null) return;
  // Only extract if there's enough conversation (at least 2 exchanges)
  const userMsgs = messages.filter(m => m.role === 'user');
  if (userMsgs.length < 1) return;

  // Take the last few messages for extraction (not the whole history)
  const recent = messages.slice(-6);
  const convoText = recent
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => `${m.role}: ${typeof m.content === 'string' ? m.content.slice(0, 500) : ''}`)
    .join('\n');

  if (convoText.length < 20) return;

  const extractionPrompt = [
    {
      role: 'system',
      content: `You are a fact extractor. Read the conversation below and extract facts about the USER (not the assistant). Facts include: name, location, job, company, projects, preferences, interests, family, pets, goals, tools they use, problems they're solving.

Rules:
- Only extract facts about the USER, not general knowledge
- Each fact should be a short, standalone sentence (e.g. "User lives in Hillsborough, CA")
- Do not repeat facts that are obvious or trivial
- If there are no new user facts, respond with exactly: []
- Respond with ONLY a JSON array of strings, nothing else. No markdown, no explanation.

Example output: ["User's name is Mayank", "User is building an AI app called Aspen", "User has a dog named Cinnamon"]`
    },
    {
      role: 'user',
      content: `Extract user facts from this conversation:\n\n${convoText}`
    }
  ];

  try {
    const body = JSON.stringify({
      model,
      messages: extractionPrompt,
      stream: false,
      options: { num_predict: 500, temperature: 0.1 },
    });

    const result = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: OLLAMA_HOST,
        port: OLLAMA_PORT,
        path: '/api/chat',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, (res) => {
        let data = '';
        res.on('data', c => { data += c; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json.message?.content || '[]');
          } catch { resolve('[]'); }
        });
      });
      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
      req.write(body);
      req.end();
    });

    // Parse the JSON array from the model's response
    const cleaned = result.replace(/```json\n?/g, '').replace(/```/g, '').trim();
    const facts = JSON.parse(cleaned);
    if (Array.isArray(facts) && facts.length > 0) {
      mergeFacts(facts, keyId);
    }
  } catch (e) {
    // Silent failure — extraction is best-effort
    console.log(`[WorldModel] Extraction failed: ${e.message}`);
  }
}

// Clear a user's memory. Uses this module's own store reference.
function clearMemory(keyId) {
  const sk = storeKeyFor(keyId);
  if (sk) store.remove(sk);
}

module.exports = {
  getFacts,
  getSystemPrefix,
  mergeFacts,
  extractFacts,
  storeKeyFor,
  clearMemory,
};
