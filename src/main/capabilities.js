/**
 * Capability tiers — the single source of truth for what a given model+machine
 * combo can actually do well, so the app degrades gracefully instead of offering
 * features that fail or are too slow.
 *
 * Principle: never compromise speed/experience; compromise FEATURES. A small
 * model (e.g. 4B) may *report* tool support but is unreliable at agentic loops,
 * so we run it as fast chat-only rather than letting it stall in failed tool
 * calls. Bigger models unlock more. Weak hardware disables the heaviest
 * (multi-inference) features regardless of model.
 *
 * This module is intentionally Electron-free (uses global fetch + system.js) so
 * the desktop agent, the gateway agent (web/mobile), and the IPC layer can all
 * share one policy.
 */
const system = require('./system');

const OLLAMA = 'http://127.0.0.1:11434';

// ── Tunable thresholds (billions of parameters) ──
const THRESHOLDS = {
  MIN_TOOLS_B: 5,         // below this, tool-calling is unreliable → chat only
  MIN_COMPUTER_USE_B: 7,  // computer use needs a capable vision model
  FULL_TIER_B: 14,        // deep research / full agentic
};

// Name-based heuristic, used ONLY when /api/show returns no capabilities array.
const TOOL_FAMILIES = ['llama3', 'llama4', 'qwen2', 'qwen2.5', 'qwen3', 'mistral', 'mixtral', 'gemma3', 'gemma4', 'phi4', 'command-r', 'hermes', 'firefunction', 'functionary', 'smollm2'];
const VISION_FAMILIES = ['llava', 'bakllava', 'moondream', 'llama3.2-vision', 'llama4', 'gemma3', 'gemma4', 'qwen2-vl', 'qwen2.5-vl', 'minicpm-v'];

// Parse a parameter count (in billions) from /api/show details or the model tag.
function parseSizeB(paramSize, modelName) {
  if (paramSize) {
    const m = String(paramSize).match(/([\d.]+)\s*([BMK]?)/i);
    if (m) {
      let n = parseFloat(m[1]);
      const unit = (m[2] || 'B').toUpperCase();
      if (unit === 'M') n /= 1000;
      if (unit === 'K') n /= 1e6;
      if (n > 0) return n;
    }
  }
  // Fallback: a size baked into the tag, e.g. "qwen3:32b", "llama3.2:3b", "gemma:2b".
  const tag = String(modelName || '').toLowerCase();
  const tm = tag.match(/(\d+(?:\.\d+)?)\s*b(?:[^a-z]|$)/);
  if (tm) { const n = parseFloat(tm[1]); if (n > 0) return n; }
  return null; // unknown
}

// Pure policy: inputs → capability profile. Fully unit-testable.
function computeProfile({ tools = false, vision = false, sizeB = null } = {}, hardwareTier = 'medium') {
  const lightHW = hardwareTier === 'light';
  // Unknown size → assume mid so we don't over-restrict a model we can't measure.
  const size = sizeB == null ? 8 : sizeB;

  const canTools = !!tools && size >= THRESHOLDS.MIN_TOOLS_B;
  const canComputerUse = canTools && !!vision && size >= THRESHOLDS.MIN_COMPUTER_USE_B && !lightHW;
  const canDeepResearch = canTools && size >= THRESHOLDS.FULL_TIER_B && !lightHW;

  let tier, label, tagline;
  if (!canTools) {
    tier = 'chat';
    label = 'Chat';
    tagline = (sizeB && sizeB < THRESHOLDS.MIN_TOOLS_B)
      ? 'Compact model tuned for fast conversation. Tools and automation need a larger model.'
      : 'Fast conversational assistant. This model does not support tools.';
  } else if (size >= THRESHOLDS.FULL_TIER_B) {
    tier = 'full';
    label = 'Full Agent';
    tagline = 'Web search, code execution, research, memory' + (canComputerUse ? ', and computer use.' : '.');
  } else {
    tier = 'standard';
    label = 'Assistant';
    tagline = 'Chat plus web search, calculator, and memory.';
  }

  const features = {
    chat: true,
    memory: canTools,        // fact extraction produces noise on small models
    webSearch: canTools,
    calculator: canTools,
    fetchUrl: canTools,
    runCommand: canTools,    // owner-gated elsewhere
    connectors: canTools,    // MCP tools are tool calls
    deepResearch: canDeepResearch,
    computerUse: canComputerUse,
  };

  // The tool NAMES this combo may use. The agent intersects this with the user's
  // enabled-tools setting; if the result is empty the model runs as plain chat.
  const allowedTools = [];
  if (features.webSearch) allowedTools.push('web_search', 'fetch_url');
  if (features.calculator) allowedTools.push('calculate', 'get_datetime');
  if (features.runCommand) allowedTools.push('run_command', 'download_file');
  if (features.deepResearch) allowedTools.push('deep_research');
  if (features.computerUse) allowedTools.push('computer_use');

  const why = (ok, ...checks) => ok ? null : (checks.find(c => c[0])?.[1] || null);
  const reasons = {
    tools: why(canTools, [!tools, 'this model does not support tools'], [size < THRESHOLDS.MIN_TOOLS_B, 'model is too small for reliable tools']),
    computerUse: why(canComputerUse, [!vision, 'needs a vision model'], [!canTools, 'needs tool support'], [size < THRESHOLDS.MIN_COMPUTER_USE_B, 'needs a larger model'], [lightHW, 'needs a faster machine']),
    deepResearch: why(canDeepResearch, [!canTools, 'needs tool support'], [size < THRESHOLDS.FULL_TIER_B, 'needs a larger model'], [lightHW, 'needs a faster machine']),
  };

  return { tier, label, tagline, sizeB, tools: !!tools, vision: !!vision, hardwareTier, features, allowedTools, reasons };
}

// Heuristic capabilities from a model name (fallback when /api/show is bare).
function heuristicCaps(modelName) {
  const base = String(modelName || '').split(':')[0].toLowerCase();
  const hit = (list) => list.some((f) => base === f || base.startsWith(f));
  return { tools: hit(TOOL_FAMILIES), vision: hit(VISION_FAMILIES) };
}

// ── Async profile from a live Ollama model (cached per model name) ──
const _cache = new Map();

async function fetchModelMeta(model) {
  try {
    const res = await fetch(`${OLLAMA}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    });
    if (res.ok) {
      const data = await res.json();
      const caps = Array.isArray(data.capabilities) ? data.capabilities : [];
      const sizeB = parseSizeB(data.details && data.details.parameter_size, model);
      if (caps.length > 0) return { tools: caps.includes('tools'), vision: caps.includes('vision'), sizeB };
      return { ...heuristicCaps(model), sizeB };
    }
  } catch { /* fall through */ }
  return { ...heuristicCaps(model), sizeB: parseSizeB(null, model) };
}

async function getProfile(model, { force = false } = {}) {
  let hwTier = 'medium';
  try { hwTier = system.getHardwareTier(); } catch {}
  if (!model) return computeProfile({}, hwTier);
  if (!force && _cache.has(model)) return _cache.get(model);
  const meta = await fetchModelMeta(model);
  const profile = computeProfile(meta, hwTier);
  _cache.set(model, profile);
  return profile;
}

function clearCache(model) { if (model) _cache.delete(model); else _cache.clear(); }

module.exports = { THRESHOLDS, parseSizeB, computeProfile, heuristicCaps, getProfile, clearCache };
