'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Streaming artifact fencer.
//
// The chat clients (desktop iframe, iPhone WKWebView) only render html/svg as a
// live artifact when it arrives inside a ``` fence. The model is supposed to
// fence it, but sometimes pastes a bare <figure>/<img>/<svg> straight into the
// reply — which then shows as plain text and the user sees nothing.
//
// This normalizer sits on the gateway's content stream and guarantees such a
// block is fenced before it reaches any client. It is deliberately conservative:
//   • only acts on <figure>, <svg>, <img>, <!doctype html>, <html> at the START
//     of a line, and only when NOT already inside a ``` fence;
//   • passes everything else through character-for-character, unchanged;
//   • streams normally — only a line that begins with '<' is briefly buffered
//     (to a newline) so a fence can be injected ahead of it; ordinary prose
//     flushes immediately.
//
// Pure and synchronous so it can be unit-tested (see artifact-fence.test.js).
// ─────────────────────────────────────────────────────────────────────────────

function makeArtifactFencer() {
  const OPEN_RX = /^\s*<(figure|svg|img|!doctype|html)\b/i;
  let inModelFence = false; // inside a ``` block the model itself wrote
  let inAuto = false;       // inside a fence we injected
  let closer = null;        // matching close tag for the auto fence, e.g. '</figure>'
  let line = '';            // current line buffer
  let decided = null;       // null | 'pass' | 'hold'  (meaningful only when !inAuto)
  let emitted = 0;          // chars of `line` already emitted while in 'pass'

  const closerFor = (tag) => (tag.toLowerCase() === '!doctype' ? '</html>' : '</' + tag.toLowerCase() + '>');
  const ensureNL = (s) => (s.endsWith('\n') ? s : s + '\n');

  // A fully-buffered line that began with '<'. Decide whether to fence it.
  function wrapHeld(full) {
    const m = full.match(OPEN_RX);
    if (!m) return full; // not one of our artifact tags → leave untouched
    const tag = m[1];
    const cl = closerFor(tag);
    const flat = full.replace(/\n$/, '');
    const selfContained =
      tag.toLowerCase() === 'img' ||
      /\/>\s*$/.test(flat) ||
      full.toLowerCase().includes(cl.toLowerCase());
    if (selfContained) return '```html\n' + ensureNL(full) + '```\n';
    inAuto = true; closer = cl;
    return '```html\n' + full;
  }

  function finishLine() {
    let out = '';
    if (inAuto) {
      out += line;
      if (closer && line.toLowerCase().includes(closer.toLowerCase())) {
        out += '```\n'; inAuto = false; closer = null;
      }
    } else if (decided === 'hold') {
      out += wrapHeld(line);
    } else if (decided === 'pass') {
      if (line.trim().startsWith('```')) inModelFence = !inModelFence;
      // body already emitted during push()
    } else {
      out += line; // whitespace-only line, not yet emitted
    }
    line = ''; decided = null; emitted = 0;
    return out;
  }

  return {
    push(text) {
      let out = '';
      for (const c of text) {
        line += c;
        if (!inAuto && decided === null) {
          const t = line.replace(/^\s+/, '');
          if (t.length > 0) {
            if (!inModelFence && t[0] === '<') {
              decided = 'hold';                 // buffer line, decide at newline
            } else {
              decided = 'pass';
              out += line.slice(emitted);       // flush the leading buffer now
              emitted = line.length;
            }
          }
        } else if (!inAuto && decided === 'pass') {
          out += c; emitted = line.length;
        }
        // inAuto, or decided === 'hold' → silently buffer until newline
        if (c === '\n') out += finishLine();
      }
      return out;
    },
    end() {
      let out = '';
      if (line.length) {
        if (inAuto) {
          out += line;
          if (!(closer && line.toLowerCase().includes(closer.toLowerCase()))) out += '\n';
          out += '```\n'; inAuto = false;
        } else if (decided === 'hold') {
          out += wrapHeld(line);
          if (inAuto) { out += '\n```\n'; inAuto = false; } // opened, never closed
        } else if (decided !== 'pass') {
          out += line; // whitespace-only remainder
        }
      } else if (inAuto) {
        out += '```\n'; inAuto = false;
      }
      line = ''; decided = null; emitted = 0;
      return out;
    },
  };
}

module.exports = { makeArtifactFencer };
