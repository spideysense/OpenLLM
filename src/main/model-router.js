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

const CODING_RX = /\b(code|coding|extension|manifest|function|script|bug|error|deploy|html|css|javascript|typescript|python|react|vue|node\.js|api|program|website|debug|refactor|compile|traceback|stack trace|exception|component|regex|sql)\b/i;

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
    if (isCoderName(requested) || !CODING_RX.test(text)) return requested; // fast path, no /api/tags
    const list = await installedModelsDetailed();
    return decideCodingModel({ requested, text, list, ramBytes: os.totalmem(), ctx: system.getRecommendedContext() });
  } catch {
    return requested;
  }
}

module.exports = { CODING_RX, isCoderName, modelSizeFromList, decideCodingModel, installedModelsDetailed, routeModel };
