// context-minimizer.js — privacy gate for cloud egress.
//
// Aspen's promise is that personal data stays on the box. When a request is
// (explicitly) boosted to a cloud model, this is the chokepoint every message
// passes through first: it redacts PII/secrets and trims context to the minimum
// needed to answer. Pure + synchronous so it's unit-testable and can't leak by
// being async-skipped. Nothing reaches a cloud provider that didn't go through here.

const REDACTIONS = [
  [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '[email]'],
  [/\b(?:sk|pk)-[A-Za-z0-9_-]{12,}\b/g, '[secret]'],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, '[secret]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[secret]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[secret]'],
  [/\bBearer\s+[A-Za-z0-9._-]{12,}\b/g, 'Bearer [secret]'],
  [/\b\d{13,19}\b/g, '[number]'],                       // card-ish long digit runs
  [/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '[ip]'],
  [/\/Users\/[^/\s]+/g, '/Users/[user]'],
  [/\/home\/[^/\s]+/g, '/home/[user]'],
  [/(\+?\d[\d\s().-]{7,}\d)/g, '[phone]'],
];

function redactText(s, extra = []) {
  let out = String(s == null ? '' : s);
  let hits = 0;
  const rules = [...REDACTIONS, ...extra];
  for (const [rx, rep] of rules) {
    out = out.replace(rx, (m) => { hits++; return rep; });
  }
  return { text: out, hits };
}

// identifiers: user-specific strings to scrub (name, company, usernames) — these
// live only on the box and should never be needed to answer a question.
function extraRulesFor(identifiers = []) {
  return identifiers.filter(Boolean).map((id) => [new RegExp(escapeRx(id), 'gi'), '[redacted]']);
}
function escapeRx(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Trim to the minimal context: keep the system instruction (sanitized) + the
// last `keepTurns` messages. Drops older history that isn't needed to answer the
// current question — less context out means less exposure.
function minimizeForCloud(messages = [], { keepTurns = 6, identifiers = [] } = {}) {
  const extra = extraRulesFor(identifiers);
  let redactions = 0;
  const out = [];

  const system = messages.find((m) => m.role === 'system');
  if (system) {
    // Strip personal/local context from the system prompt; keep only a short,
    // generic instruction so the cloud model behaves, without learning about the box.
    const r = redactText(typeof system.content === 'string' ? system.content : '', extra);
    redactions += r.hits;
    out.push({ role: 'system', content: 'You are a helpful assistant. Answer the user\'s question directly.' });
  }

  const turns = messages.filter((m) => m.role !== 'system').slice(-keepTurns);
  for (const m of turns) {
    const content = typeof m.content === 'string'
      ? m.content
      : Array.isArray(m.content)
        ? m.content.map((c) => (typeof c === 'string' ? c : c.text || '')).join('\n')
        : '';
    const r = redactText(content, extra);
    redactions += r.hits;
    out.push({ role: m.role, content: r.text });
  }
  return { messages: out, redactions };
}

module.exports = { minimizeForCloud, redactText };
