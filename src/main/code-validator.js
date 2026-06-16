// ─────────────────────────────────────────────────────────────────────────────
// Code validator — checks model-generated code BEFORE the user sees it.
// It only COMPILES/PARSES code (never executes it), so it is safe on any output.
// Two layers:
//   1) syntax — vm.Script for JS (compile-only), JSON.parse for JSON
//   2) lint   — known LLM hallucinations / anti-patterns that syntax can't catch
//              (e.g. chrome.commands.register, MV3 permission mistakes)
// The point: catch "this won't even load" errors and hand them back to the model
// to fix, instead of making the user the error channel.
// ─────────────────────────────────────────────────────────────────────────────
const vm = require('vm');

// Pull fenced code blocks: ```lang\n...\n```
function extractCodeBlocks(text) {
  const blocks = [];
  const rx = /```([\w.+#-]*)[ \t]*\r?\n([\s\S]*?)```/g;
  let m;
  while ((m = rx.exec(text || ''))) {
    blocks.push({ lang: (m[1] || '').toLowerCase().trim(), code: m[2] });
  }
  return blocks;
}

function classify(lang, code) {
  if (['js', 'javascript', 'mjs', 'cjs', 'node'].includes(lang)) return 'js';
  if (['jsx', 'tsx', 'ts', 'typescript'].includes(lang)) return 'jsx-or-ts';
  if (['json', 'jsonc'].includes(lang)) return 'json';
  if (['html', 'htm'].includes(lang)) return 'html';
  if (['sh', 'bash', 'shell', 'zsh'].includes(lang)) return 'shell';
  if (['py', 'python'].includes(lang)) return 'python';
  const t = (code || '').trim();
  if (!lang && (t.startsWith('{') || t.startsWith('['))) return 'json';
  if (!lang && /^<!doctype html|^<html/i.test(t)) return 'html';
  return lang || 'unknown';
}

// Looks like JSX/embedded markup → vm can't parse it; skip the syntax check
// (lint still runs) to avoid false positives that would trigger pointless retries.
function looksLikeJsx(code) {
  return /<[A-Za-z][\w.]*[\s/>]/.test(code) || /<\/[a-zA-Z]/.test(code);
}

function checkJsSyntax(code) {
  try {
    // Compiles only — does NOT run the code. No I/O, no side effects.
    new vm.Script(code, { filename: 'snippet.js' });
    return null;
  } catch (e) {
    return `JavaScript syntax error: ${e.message.split('\n')[0]}`;
  }
}

function checkJson(code) {
  try {
    JSON.parse(code);
    return null;
  } catch (e) {
    return `Invalid JSON: ${e.message}`;
  }
}

// Semantic anti-patterns / hallucinated APIs (syntax-valid but wrong).
const LINT_RULES = [
  { rx: /chrome\.commands\.register\s*\(/, msg: 'chrome.commands.register() is not a real API. Keyboard shortcuts are declared in manifest.json under "commands" — not registered from JavaScript.' },
  { rx: /chrome\.extension\.(getURL|sendMessage|onRequest|onConnect)\b/, msg: 'chrome.extension.* is removed in Manifest V3. Use chrome.runtime.* instead.' },
  { rx: /["']background["']\s*:\s*\{[^}]*["']scripts["']\s*:/, msg: 'Manifest V3 background must use "service_worker", not "scripts".' },
  { rx: /["']content_security_policy["']\s*:\s*["']/, msg: 'In Manifest V3, content_security_policy is an object (e.g. { "extension_pages": "..." }), not a string.' },
  { rx: /content_security_policy[\s\S]{0,120}unsafe-inline/, msg: 'Manifest V3 does not allow "unsafe-inline" in content_security_policy. Inline <script> is blocked; move the JavaScript into a separate .js file and load it with <script src="...">.' },
  { rx: /["']suggested_key["'][\s\S]{0,160}\b(Cmd|Option)\b/, msg: 'In manifest "suggested_key", Chrome uses "Command", "MacCtrl", "Alt", "Shift", "Ctrl" — not "Cmd" or "Option". Use e.g. "default": "Ctrl+Shift+Y" and "mac": "Command+Shift+Y", and every shortcut needs a non-shift modifier plus a key.' },
];

// Inline <script> in an extension HTML page that calls chrome.* is the single
// most common MV3 failure (CSP blocks it, then the model "fixes" it wrong in a
// loop). High-precision: only flag inline scripts that actually use chrome APIs,
// so ordinary HTML demos with inline script aren't touched.
function checkExtensionHtml(code) {
  const out = [];
  const inlineScripts = (code || '').match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi) || [];
  if (inlineScripts.some((s) => /chrome\.\w/.test(s))) {
    out.push('Manifest V3 blocks inline <script> in extension pages. Move this JavaScript into a separate file (e.g. popup.js) and load it with <script src="popup.js"></script>.');
  }
  return out;
}

function lint(code) {
  const out = [];
  for (const r of LINT_RULES) if (r.rx.test(code)) out.push(r.msg);
  return out;
}

// Extra checks when a JSON block is actually a Chrome extension manifest.
function checkManifest(obj) {
  const out = [];
  if (obj.manifest_version && obj.manifest_version !== 3) {
    out.push('Use "manifest_version": 3 for new Chrome extensions.');
  }
  if (Array.isArray(obj.permissions)) {
    const hostish = obj.permissions.filter((p) => typeof p === 'string' && (p === '<all_urls>' || /:\/\//.test(p) || p.includes('*://')));
    if (hostish.length) out.push('Host match patterns like "<all_urls>" or "*://*/*" must go under "host_permissions", not "permissions".');
  }
  if (obj.background && obj.background.scripts) {
    out.push('Manifest V3 background must be a "service_worker", not "scripts".');
  }
  if (obj.commands && typeof obj.commands === 'object') {
    for (const [name, def] of Object.entries(obj.commands)) {
      if (name === '_execute_action' || name === '_execute_browser_action' || name === '_execute_page_action') continue;
      if (def && typeof def === 'object' && !def.description) {
        out.push(`The "${name}" entry in manifest "commands" needs a "description" — Chrome rejects custom commands without one.`);
      }
    }
  }
  return out;
}

function validateBlock({ lang, code }) {
  const kind = classify(lang, code);
  const errors = [];

  if (kind === 'js') {
    if (!looksLikeJsx(code)) {
      const syn = checkJsSyntax(code);
      if (syn) errors.push(syn);
    }
    errors.push(...lint(code));
  } else if (kind === 'json') {
    errors.push(...lint(code)); // source-level rules (CSP string, unsafe-inline, Cmd/Option keys)
    const j = checkJson(code);
    if (j) {
      errors.push(j);
    } else {
      try {
        const obj = JSON.parse(code);
        if (obj && (obj.manifest_version || obj.content_scripts || obj.background || obj.action)) {
          errors.push(...checkManifest(obj));
        }
      } catch {}
    }
  } else if (kind === 'html' || kind === 'jsx-or-ts') {
    // Can't reliably compile these here — run lint only (catches hallucinated APIs).
    errors.push(...lint(code));
    if (kind === 'html') errors.push(...checkExtensionHtml(code));
  }
  // python/shell/unknown: skipped (no safe in-process compiler available)

  return { kind, ok: errors.length === 0, errors };
}

// Validate a whole assistant answer. Returns deduped, human-readable problems
// suitable for handing back to the model.
function validateAnswer(text) {
  const blocks = extractCodeBlocks(text);
  const seen = new Set();
  const problems = [];
  for (const b of blocks) {
    for (const e of validateBlock(b).errors) {
      if (!seen.has(e)) { seen.add(e); problems.push(e); }
    }
  }
  return { ok: problems.length === 0, problems, blockCount: blocks.length };
}

module.exports = {
  extractCodeBlocks,
  classify,
  checkJsSyntax,
  checkJson,
  validateBlock,
  validateAnswer,
};
