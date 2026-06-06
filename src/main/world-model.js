/**
 * World Model engine — learns about the user from conversations.
 *
 * After each exchange, silently extracts new facts using the local model.
 * Before each new chat, prepends known facts as context.
 * Everything stays local — facts are stored in electron-store.
 */

const store = require('./store');
const http = require('http');

const OLLAMA_HOST = '127.0.0.1';
const OLLAMA_PORT = 11434;
const MAX_FACTS = 100; // Cap to keep context manageable

/**
 * Get all known facts about the user.
 */
function getFacts() {
  const wm = store.get('worldModel') || { facts: [] };
  return wm.facts || [];
}

/**
 * Build a system prompt prefix from the world model.
 * Prepended to every conversation so the model knows the user.
 */
function getSystemPrefix() {
  const facts = getFacts();
  if (facts.length === 0) return '';
  return `Here is what you know about the user from past conversations (use naturally, don't list back):\n${facts.map(f => `- ${f}`).join('\n')}\n\n`;
}

/**
 * Merge new facts into the world model, avoiding duplicates.
 */
function mergeFacts(newFacts) {
  const wm = store.get('worldModel') || { facts: [] };
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
  store.set('worldModel', { facts: allFacts, updatedAt: new Date().toISOString() });
  console.log(`[WorldModel] Added ${added.length} new facts: ${added.join('; ')}`);
  return added.length;
}

/**
 * Extract facts from a conversation using the local model.
 * Runs in the background after each exchange — non-blocking.
 */
async function extractFacts(model, messages) {
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
      mergeFacts(facts);
    }
  } catch (e) {
    // Silent failure — extraction is best-effort
    console.log(`[WorldModel] Extraction failed: ${e.message}`);
  }
}

module.exports = {
  getFacts,
  getSystemPrefix,
  mergeFacts,
  extractFacts,
};
