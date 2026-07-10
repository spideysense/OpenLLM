/**
 * Regression guards for the 2026-07-10 web-app stabilization pass.
 * Coarse source-level assertions (same spirit as regression-guards.test.js) that
 * prevent THIS session's specific fixes from being silently undone. Each mapped to
 * a real, user-visible breakage. Paths are cwd-relative (vitest runs from repo root).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = fs.readFileSync(path.resolve('site/app/index.html'), 'utf8');
const GATEWAY = fs.readFileSync(path.resolve('src/main/gateway-agent.js'), 'utf8');

function appScript() {
  const m = APP.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/);
  expect(m, 'web app has an inline <script> block').toBeTruthy();
  return m[1];
}

describe('web-app regression guards (2026-07-10)', () => {
  it('inline script parses (gross syntax breakage)', () => {
    // NOTE: a parse check does NOT catch the cloudFrom class (out-of-scope refs are
    // valid syntax) — that is guarded separately below.
    expect(() => new vm.Script(appScript())).not.toThrow();
  });

  it('cloudFrom is hoisted before the try (scope crash)', () => {
    // cloudFrom declared inside sendMessage's try but read after it → ReferenceError
    // on every send, which cascaded into: no saved reply, stuck stop button, blocked
    // chat-switch, and missions never triggering. Must stay next to fullText.
    expect(/let fullText='';let cloudFrom=null;/.test(appScript())).toBe(true);
  });

  it('streams are scoped to the chat that started them', () => {
    const s = appScript();
    expect(/const originId=activeChatId;/.test(s)).toBe(true);            // capture origin
    expect(/const c=chats\[originId\];/.test(s)).toBe(true);              // commit to origin
    expect(/if\(isStreaming\)return;activeChatId=id/.test(s)).toBe(false); // switchChat not blocked
    expect(/if\(artMatch&&activeChatId===originId\)/.test(s)).toBe(true);  // artifact only for origin
  });

  it('artifact panel closes on new chat and chat switch', () => {
    const s = appScript();
    expect(/renderMessages\(\);closeArtifactPanel\(\);chatTitle\.textContent='New chat'/.test(s)).toBe(true);
    expect(/renderMessages\(\);closeArtifactPanel\(\);\s*chatTitle\.textContent=chats\[id\]/.test(s)).toBe(true);
  });

  it('mission-list dot is a dot, not a blob', () => {
    // A <span> dot matched '.chat-item span{flex:1}' and stretched into a green blob.
    expect(/border-radius:50%;flex:0 0 auto;background:/.test(APP)).toBe(true);
    expect(/border-radius:50%;flex-shrink:0;background:\$\{dotColor/.test(APP)).toBe(false);
  });

  it('composer stays pinned (empty-state class cleared on first message)', () => {
    // '.chat-main.empty' centers the composer and makes .messages grow instead of
    // scroll; appendMessage must drop the class so the composer never scrolls off.
    expect(/function appendMessage[\s\S]{0,200}chatMain\.classList\.remove\('empty'\)/.test(appScript())).toBe(true);
  });

  it('deterministic mission trigger stays owner-only', () => {
    // Relaxed then reverted by decision (the key is an owner key); missions run with
    // full owner tool access, so the trigger must stay gated on args.isOwner.
    expect(/if \(args\.isOwner && !args\.background && _u\.length > 15 && CONTINUE_RX\.test\(_u\)/.test(GATEWAY)).toBe(true);
  });
});
