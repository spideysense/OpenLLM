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
const system = require('./system');

const OLLAMA_HOST = '127.0.0.1';
const OLLAMA_PORT = 11434;
const MAX_FACTS = 100; // Cap to keep context manageable

// Models small enough to extract facts without stalling the chat queue. Used as
// a name-based fallback; the primary check below is SIZE-based so any small
// resident model qualifies regardless of exact tag.
const SMALL_EXTRACTION_MODELS = [
  'qwen3:1.7b', 'qwen3:4b', 'qwen3:8b', 'qwen3:14b',
  'llama3.2:1b', 'llama3.2:3b',
  'qwen2.5:1.5b', 'qwen2.5:3b',
  'gemma2:2b', 'gemma3:4b', 'phi3:mini', 'smollm2:1.7b',
];
// A resident model at or under this many billion params is safe for extraction.
const MAX_EXTRACTION_PARAMS_B = 14;

function httpGetJson(path) {
  return new Promise((resolve) => {
    const req = http.request({ hostname: OLLAMA_HOST, port: OLLAMA_PORT, path, method: 'GET' }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(3000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// Parse a billions-of-params number from an Ollama /api/ps details string
// ("3.2B", "1.7B") or a model tag ("llama3.2:3b"). Returns null if unknown.
function paramsB(model) {
  const fromDetails = model?.details?.parameter_size;
  const s = fromDetails || model?.name || (typeof model === 'string' ? model : '');
  const m = String(s).match(/([\d.]+)\s*b/i);
  return m ? parseFloat(m[1]) : null;
}

// Choose a SAFE model for background fact extraction. Critical rule: never pick
// a model that isn't already loaded — loading a second model can evict the
// resident chat model (Ollama caps how many stay in memory), forcing a
// multi-minute reload on the user's NEXT message. We ONLY use a small model
// that is already in memory; otherwise return null and the caller skips.
//
// Selection is SIZE-based first (any resident model <= MAX_EXTRACTION_PARAMS_B
// that isn't the chat model), so it works no matter which small model is pinned;
// the hardcoded name list is a fallback for when /api/ps omits the param size.
async function pickExtractionModel(chatModel) {
  const ps = await httpGetJson('/api/ps');
  const resident = ps?.models || [];

  // Primary: smallest resident model under the size cap, excluding the chat model.
  let best = null, bestB = Infinity;
  for (const m of resident) {
    if (m.name === chatModel) continue;
    const b = paramsB(m);
    if (b != null && b <= MAX_EXTRACTION_PARAMS_B && b < bestB) { best = m.name; bestB = b; }
  }
  if (best) return best;

  // Fallback: name-list match among resident models (when size is unavailable).
  const loadedNames = resident.map(m => m.name);
  for (const small of SMALL_EXTRACTION_MODELS) {
    if (loadedNames.includes(small) && small !== chatModel) return small;
  }

  // No small model resident → skip. Do NOT load one (it would evict the chat
  // model) and never run extraction on the heavy chat model itself.
  return null;
}


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
  try {
    const wm = store.get(sk) || { facts: [] };
    return (wm && Array.isArray(wm.facts)) ? wm.facts : [];
  } catch {
    // A corrupt/unavailable store must never break a reply — memory is optional.
    return [];
  }
}

/**
 * Build a system prompt prefix from a user's world model.
 */
// Facts too sensitive to ever inject into the always-on prompt. A small model
// will lead with whatever it sees, so mental-health / health / other private
// topics are kept OUT of the background context entirely — the model can still
// respond if the USER raises them in their message, it just won't volunteer them.
const SENSITIVE_RX = /\b(depress|anxiet|suicid|self.?harm|mental[\s-]?health|therap|counsel|bipolar|schizo|ptsd|trauma|diagnos|cancer|illness|disease|chronic|disorder|medicat|addict|alcohol|rehab|divorc|breakup|grief|griev|miscarri|pregnan|abuse|fired|laid off|bankrupt|debt)/i;

function getSystemPrefix(keyId) {
  const facts = getFacts(keyId).filter((f) => !SENSITIVE_RX.test(String(f)));
  if (facts.length === 0) return '';
  return `Background on the user from past chats — CONTEXT ONLY. Do NOT list these back, open a reply with them, or bring any of them up unless the user's current message is directly about that specific topic. Answer what the user actually asked, first and directly.\n${facts.map((f) => `- ${f}`).join('\n')}\n\n`;
}

/**
 * Merge new facts into a user's world model, avoiding duplicates.
 */
function mergeFacts(newFacts, keyId) {
  const sk = storeKeyFor(keyId);
  if (!sk) return 0; // anonymous: don't store anything
  try {
    const wm = store.get(sk) || { facts: [] };
    const existing = new Set(((wm && wm.facts) || []).map(f => f.toLowerCase().trim()));
    const added = [];

    for (const fact of newFacts) {
      const trimmed = fact.trim();
      if (!trimmed || trimmed.length < 5) continue;
      if (existing.has(trimmed.toLowerCase())) continue;
      existing.add(trimmed.toLowerCase());
      added.push(trimmed);
    }

    if (added.length === 0) return 0;

    const allFacts = [...((wm && wm.facts) || []), ...added].slice(-MAX_FACTS);
    store.set(sk, { facts: allFacts, updatedAt: new Date().toISOString() });
    console.log(`[WorldModel:${keyId || 'owner'}] Added ${added.length} new facts`);
    return added.length;
  } catch {
    return 0; // extraction is best-effort — a failing store must not throw
  }
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

  // Use a SMALL, FAST model for extraction — never the heavy chat model.
  // Running a 109B model to extract facts blocks Ollama's queue for 30-60s,
  // which stalls the user's NEXT message. A small model does this in ~2s.
  // Prefer an already-loaded small model; fall back to the chat model only
  // if nothing small is available.
  const extractionModel = await pickExtractionModel(model);
  // No small extraction model installed → skip. Never run extraction on the heavy
  // chat model: it uses a different context size, which evicts + reloads the
  // resident model and makes the user's next message pay a full cold-load.
  if (!extractionModel || extractionModel === model) return;

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
      model: extractionModel,
      messages: extractionPrompt,
      stream: false,
      // Small model + small context = fast extraction that doesn't block chat.
      // keep_alive shorter so the extraction model doesn't permanently hold VRAM.
      keep_alive: '5m',
      options: { num_predict: 300, temperature: 0.1, num_ctx: 4096 },
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
  paramsB,
  pickExtractionModel,
  SMALL_EXTRACTION_MODELS,
  MAX_EXTRACTION_PARAMS_B,
};
