// cloud-providers.js — adapters for optional cloud "Boost". Each provider is
// normalized to a single chat(messages) -> {text} call. Model IDs are env-
// overridable because they churn; defaults are sensible but VERIFY current IDs.
//
// tier 'free' = has a real no-card free tier (rotate across these for $0).
// tier 'byok' = bring-your-own paid key (Claude/GPT/Gemini-Pro top models).
//
// FOUNDATION: this module performs the cloud calls but is only invoked by
// cloud.js when the user has explicitly enabled Boost. It is never called on the
// default local path.
const E = process.env;

const PROVIDERS = {
  // ── genuinely free tiers (official keys, one signup, no card) ──────────────
  gemini_flash: { label: 'Gemini Flash', tier: 'free', kind: 'gemini', env: 'GEMINI_API_KEY',
    model: E.GEMINI_FLASH_MODEL || 'gemini-2.0-flash' },
  groq: { label: 'Groq', tier: 'free', kind: 'openai', env: 'GROQ_API_KEY',
    base: 'https://api.groq.com/openai/v1', model: E.GROQ_MODEL || 'llama-3.3-70b-versatile' },
  openrouter_free: { label: 'OpenRouter (free)', tier: 'free', kind: 'openai', env: 'OPENROUTER_API_KEY',
    base: 'https://openrouter.ai/api/v1', model: E.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free' },
  cerebras: { label: 'Cerebras', tier: 'free', kind: 'openai', env: 'CEREBRAS_API_KEY',
    base: 'https://api.cerebras.ai/v1', model: E.CEREBRAS_MODEL || 'llama-3.3-70b' },
  mistral: { label: 'Mistral', tier: 'free', kind: 'openai', env: 'MISTRAL_API_KEY',
    base: 'https://api.mistral.ai/v1', model: E.MISTRAL_MODEL || 'mistral-large-latest' },
  glm: { label: 'GLM / Zhipu', tier: 'free', kind: 'openai', env: 'ZHIPU_API_KEY',
    base: 'https://open.bigmodel.cn/api/paas/v4', model: E.GLM_MODEL || 'glm-4-flash' },
  // ── bring-your-own-key (paid top models) ───────────────────────────────────
  anthropic: { label: 'Claude', tier: 'byok', kind: 'anthropic', env: 'ANTHROPIC_API_KEY',
    model: E.ANTHROPIC_MODEL || 'claude-sonnet-4-5' },
  openai: { label: 'OpenAI', tier: 'byok', kind: 'openai', env: 'OPENAI_API_KEY',
    base: 'https://api.openai.com/v1', model: E.OPENAI_MODEL || 'gpt-4o' },
  gemini_pro: { label: 'Gemini Pro', tier: 'byok', kind: 'gemini', env: 'GEMINI_API_KEY',
    model: E.GEMINI_PRO_MODEL || 'gemini-2.5-pro' },
};

const keyOf = (p) => E[p.env] || '';
function configured() {
  return Object.entries(PROVIDERS).filter(([, p]) => keyOf(p)).map(([id, p]) => ({ id, ...p }));
}

async function callOpenAICompat(p, messages, { timeoutMs = 30000 } = {}) {
  const res = await fetch(`${p.base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${keyOf(p)}` },
    body: JSON.stringify({ model: p.model, messages, max_tokens: 2048 }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw httpErr(res.status, await safeText(res));
  const j = await res.json();
  return { text: j.choices?.[0]?.message?.content || '' };
}

async function callAnthropic(p, messages, { timeoutMs = 30000 } = {}) {
  const system = messages.find((m) => m.role === 'system')?.content;
  const msgs = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': keyOf(p), 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: p.model, max_tokens: 2048, ...(system ? { system } : {}), messages: msgs }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw httpErr(res.status, await safeText(res));
  const j = await res.json();
  return { text: (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('') };
}

async function callGemini(p, messages, { timeoutMs = 30000 } = {}) {
  const sys = messages.find((m) => m.role === 'system')?.content;
  const contents = messages.filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.content || '') }] }));
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${p.model}:generateContent?key=${keyOf(p)}`;
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...(sys ? { systemInstruction: { parts: [{ text: sys }] } } : {}), contents }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw httpErr(res.status, await safeText(res));
  const j = await res.json();
  return { text: (j.candidates?.[0]?.content?.parts || []).map((x) => x.text).join('') };
}

async function call(provider, messages, opts) {
  if (provider.kind === 'anthropic') return callAnthropic(provider, messages, opts);
  if (provider.kind === 'gemini') return callGemini(provider, messages, opts);
  return callOpenAICompat(provider, messages, opts);
}

function httpErr(status, body) { const e = new Error(`HTTP ${status}: ${String(body).slice(0, 200)}`); e.status = status; return e; }
async function safeText(res) { try { return await res.text(); } catch { return ''; } }

module.exports = { PROVIDERS, configured, call };
