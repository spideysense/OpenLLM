// Single source of truth for decoding LLM tool-call arguments.
//
// Arguments arrive in TWO shapes depending on the endpoint:
//   • Ollama native /api/chat  → already-parsed OBJECT: { query: 'x' }
//   • OpenAI / text-tool-calls → JSON STRING:           '{"query":"x"}'
//
// Calling JSON.parse on the object form coerces it to '[object Object]' and throws,
// which (with a swallowed catch) silently drops every argument. That bug broke web
// search in BOTH agents independently. Both now call this one function, so the fix
// can never diverge again. No requires here on purpose — keep it trivially testable.
function parseToolArgs(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw === 'string' && raw.trim()) {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return {};
}

module.exports = { parseToolArgs };
