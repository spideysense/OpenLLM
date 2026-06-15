// ─────────────────────────────────────────────────────────────────────────────
// Secrets — owner-only credential store for git/deploy tokens.
// The model NEVER sees a token value: it references a secret by name, the tools
// inject it at exec time, and redact() scrubs it from every output and error
// before anything is returned to the model or logged.
// Stored on the owner's own machine at ~/.aspen/secrets.json (0600).
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const os = require('os');

const DIR = path.join(os.homedir(), '.aspen');
const FILE = path.join(DIR, 'secrets.json');

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; }
}
function save(obj) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(obj), { mode: 0o600 });
    try { fs.chmodSync(FILE, 0o600); } catch {}
    return true;
  } catch { return false; }
}

function setSecret(name, value) {
  if (!name || !value) return false;
  const o = load();
  o[String(name)] = String(value);
  return save(o);
}
function getSecret(name) { return load()[String(name)] || null; }
function listSecretNames() { return Object.keys(load()); }
function deleteSecret(name) { const o = load(); delete o[String(name)]; return save(o); }

// Remove every stored secret value from a string, plus anything that LOOKS like
// a GitHub token even if it wasn't stored. Belt and suspenders — a token must
// never surface in tool output, an error message, or a model prompt.
function redact(text) {
  if (text == null) return text;
  let out = String(text);
  for (const v of Object.values(load())) {
    const s = String(v);
    if (s.length >= 6) out = out.split(s).join('••••redacted••••');
  }
  out = out
    .replace(/gh[pousr]_[A-Za-z0-9]{16,}/g, '••••redacted••••')
    .replace(/github_pat_[A-Za-z0-9_]{20,}/g, '••••redacted••••')
    // tokens embedded in an https URL: https://TOKEN@github.com/...
    .replace(/(https:\/\/)[^@/\s]+@/g, '$1••••redacted••••@');
  return out;
}

module.exports = { setSecret, getSecret, listSecretNames, deleteSecret, redact };
