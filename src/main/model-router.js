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
// Models that code well enough on their own that routing to a SEPARATE coder
// isn't worth keeping a second large model resident. Qwen3.x is a strong coder,
// so using one model for both chat and code keeps exactly one model in memory —
// no two-model eviction/reload thrash.
function isSelfSufficientCoder(name) {
  return /qwen3|glm-?5|deepseek-v3|gpt-oss/i.test(String(name || ''));
}

function decideCodingModel({ requested, text, list, ramBytes, ctx }) {
  if (isCoderName(requested)) return requested;            // already a coder
  if (!CODING_RX.test(text || '')) return requested;       // not a coding turn → keep loaded model
  // Coding turn: if the user installed a dedicated coder that co-fits alongside the
  // chat model, route to it (both stay pinned in memory — no thrash). Installing a
  // coder is an explicit opt-in, so it takes priority over "self-sufficient".
  const coders = (list || []).filter((m) => isCoderName(m.name)).sort((a, b) => (b.size || 0) - (a.size || 0));
  if (coders.length) {
    const coder = coders[0];
    const chatSize = modelSizeFromList(list, requested);
    const kvPer = Math.max(1.5e9, ((ctx || 16384) / 16384) * 6e9); // rough KV per model
    const coFits = chatSize > 0 && (chatSize + (coder.size || 0) + 2 * kvPer) <= ramBytes * 0.88;
    if (coFits) return coder.name;                         // co-fit → route + pin both
  }
  if (isSelfSufficientCoder(requested)) return requested;  // no co-fitting coder; base codes well itself
  return requested;
}

// Which coder (if any) should be pre-warmed at startup so a coding turn never
// cold-loads. Same co-fit logic, but ignores the per-turn text (we warm ahead).
function coderToWarm({ requested, list, ramBytes, ctx }) {
  if (isCoderName(requested)) return null;
  const coders = (list || []).filter((m) => isCoderName(m.name)).sort((a, b) => (b.size || 0) - (a.size || 0));
  if (!coders.length) return null;
  const coder = coders[0];
  const chatSize = modelSizeFromList(list, requested);
  const kvPer = Math.max(1.5e9, ((ctx || 16384) / 16384) * 6e9);
  const coFits = chatSize > 0 && (chatSize + (coder.size || 0) + 2 * kvPer) <= ramBytes * 0.88;
  return coFits ? coder.name : null;
}

// Pure decision (unit-tested): when a coder model is requested for a NON-coding
// turn (e.g. a client whose model selector defaulted to the coder), pick the
// chat model to use instead. Ranks by registry QUALITY when a rank fn is given
// (lower = better), else falls back to largest non-coder. The quality rank is
// what stops a big-but-worse model (e.g. deprecated 65GB scout) from being
// auto-selected just because it's the largest installed file.
function decideChatModel({ requested, list, rank }) {
  if (!isCoderName(requested)) return requested;           // already a chat model
  const chats = (list || []).filter((m) => !isCoderName(m.name) && !/embed/i.test(m.name));
  if (!chats.length) return requested;
  if (rank) {
    chats.sort((a, b) => {
      const ra = rank(a.name), rb = rank(b.name);
      if (ra !== rb) return ra - rb;                        // better quality first
      return (b.size || 0) - (a.size || 0);                 // tie → larger
    });
  } else {
    chats.sort((a, b) => (b.size || 0) - (a.size || 0));    // no registry → size
  }
  return chats[0].name;
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
    // plain questions never get code. Pick by registry QUALITY (not size) so a
    // deprecated big model (scout) is never resurrected over a better one.
    if (!coding) {
      let rank = null;
      try {
        const registry = require('./registry');
        const reg = await registry.getRegistry();
        if (reg) rank = (name) => registry.qualityRank(reg, name);
      } catch {}
      return decideChatModel({ requested, list, rank });
    }
    // Coding turn → upgrade chat→coder when it co-fits (or keep an existing coder).
    return decideCodingModel({ requested, text, list, ramBytes: os.totalmem(), ctx: system.getRecommendedContext() });
  } catch {
    return requested;
  }
}

module.exports = { CODING_RX, isCoderName, modelSizeFromList, decideCodingModel, coderToWarm, decideChatModel, installedModelsDetailed, routeModel };
