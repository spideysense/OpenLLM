// ─────────────────────────────────────────────────────────────────────────────
// Model router — hardware-aware, thrash-proof coder routing.
// Shared by the gateway (web/mobile) and desktop agent paths. Leaf module:
// depends only on `system` + global fetch, so it can't create a require cycle.
//
// Route coding turns to a dedicated coder model ONLY when it can stay resident
// ALONGSIDE the chat model. If the pair doesn't fit in RAM, never force a swap —
// keep using the loaded model. Big boxes pin chat+coder and route freely; small
// boxes run one model and never ping-pong.
// ─────────────────────────────────────────────────────────────────────────────
const os = require('os');
const system = require('./system');

const OLLAMA_HOST = '127.0.0.1';
const OLLAMA_PORT = 11434;

const CODING_RX = /\b(code|coding|extension|manifest|function|script|bug|error|deploy|html|css|javascript|typescript|python|react|vue|node\.js|api|program|website|web ?app|webpage|debug|refactor|compile|traceback|stack trace|exception|component|regex|sql|frontend|back ?end|npm|tailwind|json|endpoint|database|popup|localstorage)\b|\b(build|make|create|write|implement|develop|generate|add)\b[\s\S]{0,40}\b(app|web ?app|game|tool|widget|page|website|site|button|form|feature|dashboard|extension|script|component|landing page|plugin|bot|scraper)\b/i;

function isCoderName(n) { return /coder|deepseek-coder|code-/i.test(String(n || '')); }

function modelSizeFromList(list, name) {
  const base = String(name).split(':')[0];
  const m = (list || []).find((x) => x.name === name) || (list || []).find((x) => String(x.name).split(':')[0] === base);
  return (m && m.size) || 0;
}

// Pure decision (unit-tested): given the requested model, the user's text, the
// installed models with sizes, RAM and context window, return the model to run.
function decideCodingModel({ requested, text, list, ramBytes, ctx }) {
  if (isCoderName(requested)) return requested;            // already a coder
  if (!CODING_RX.test(text || '')) return requested;       // not a coding turn
  const coders = (list || []).filter((m) => isCoderName(m.name)).sort((a, b) => (b.size || 0) - (a.size || 0));
  if (!coders.length) return requested;                    // no coder installed
  const coder = coders[0];
  const chatSize = modelSizeFromList(list, requested);
  const kvPer = Math.max(1.5e9, ((ctx || 16384) / 16384) * 6e9); // rough KV per model
  const coFits = chatSize > 0 && (chatSize + (coder.size || 0) + 2 * kvPer) <= ramBytes * 0.88;
  return coFits ? coder.name : requested;                  // co-fit → pin both & route; else stay put
}

// Pure decision (unit-tested): when a coder model is requested for a NON-coding
// turn (e.g. a client whose model selector defaulted to the coder), pick the
// chat model to use instead — the largest installed non-coder. This is what
// stops "Is the vegetarian Omega 3?" from being answered by qwen2.5-coder.
function decideChatModel({ requested, list }) {
  if (!isCoderName(requested)) return requested;           // already a chat model
  const chats = (list || [])
    .filter((m) => !isCoderName(m.name) && !/embed/i.test(m.name))
    .sort((a, b) => (b.size || 0) - (a.size || 0));
  return chats.length ? chats[0].name : requested;         // largest non-coder, else keep
}

let _tagCache = { at: 0, list: [] };
async function installedModelsDetailed() {
  if (Date.now() - _tagCache.at < 60000 && _tagCache.list.length) return _tagCache.list;
  try {
    const res = await fetch(`http://${OLLAMA_HOST}:${OLLAMA_PORT}/api/tags`);
    if (res.ok) {
      const data = await res.json();
      _tagCache = { at: Date.now(), list: (data.models || []).map((m) => ({ name: m.name, size: m.size || 0 })) };
    }
  } catch {}
  return _tagCache.list;
}

async function routeModel(requested, messages) {
  try {
    const lastUser = [...(messages || [])].reverse().find((m) => m.role === 'user');
    const text = (lastUser?.content || '').slice(0, 800);
    const coding = CODING_RX.test(text);
    // Fast path: a chat model on a non-coding turn needs no decision or /api/tags.
    if (!isCoderName(requested) && !coding) return requested;
    const list = await installedModelsDetailed();
    // Non-coding turn but a coder was requested → downgrade to the chat model so
    // plain questions never get code. Fixes clients that send the wrong model
    // (e.g. an old build whose selector defaulted to the coder).
    if (!coding) return decideChatModel({ requested, list });
    // Coding turn → upgrade chat→coder when it co-fits (or keep an existing coder).
    return decideCodingModel({ requested, text, list, ramBytes: os.totalmem(), ctx: system.getRecommendedContext() });
  } catch {
    return requested;
  }
}

module.exports = { CODING_RX, isCoderName, modelSizeFromList, decideCodingModel, decideChatModel, installedModelsDetailed, routeModel };
