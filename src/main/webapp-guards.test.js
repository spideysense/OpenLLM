// Regression guards for the 2026-07-10 web-app stabilization pass.
// Same philosophy as regression-guards.test.js: coarse source-level assertions
// that don't test behavior, they prevent THIS session's specific fixes from
// being silently undone. Each of these mapped to a real, user-visible breakage.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = fs.readFileSync(path.join(__dirname, '../../site/app/index.html'), 'utf8');
const GATEWAY = fs.readFileSync(path.join(__dirname, 'gateway-agent.js'), 'utf8');

// Extract the single inline <script> block (the whole web app).
function appScript() {
  const m = APP.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/);
  assert.ok(m, 'web app has an inline <script> block');
  return m[1];
}

// ── the inline script parses ──────────────────────────────────────────────────
// Why: catches gross syntax breakage before it ships. (Note: a parse check alone
// does NOT catch the cloudFrom class — an out-of-scope reference is valid syntax
// — which is why the scope guard below is separate.)
(function parses() {
  assert.doesNotThrow(() => new vm.Script(appScript()), 'web app inline script must parse');
})();

// ── cloudFrom declared before the try (scope) ─────────────────────────────────
// Why: cloudFrom was declared with `let` INSIDE sendMessage's try block but read
// after the try/catch closed → ReferenceError on every send. That single crash
// cascaded into: no response saved, stuck stop button, chat-switch blocked, and
// missions never triggering. It must stay hoisted next to fullText.
(function cloudFromHoisted() {
  assert.ok(
    /let fullText='';let cloudFrom=null;/.test(appScript()),
    'cloudFrom must be declared before the try block (next to fullText), not inside it'
  );
})();

// ── streams are scoped to the chat that started them ──────────────────────────
// Why: switchChat() used to hard-return while streaming, so tapping a chat did
// nothing whenever a mission was streaming. Removing that guard is only safe
// because sendMessage now captures originId and commits the reply to
// chats[originId] (not chats[activeChatId]) — otherwise streams bleed across chats.
(function streamScoping() {
  const s = appScript();
  assert.ok(/const originId=activeChatId;/.test(s), 'sendMessage must capture originId at stream start');
  assert.ok(/const c=chats\[originId\];/.test(s), 'assistant reply must commit to chats[originId]');
  assert.ok(
    !/if\(isStreaming\)return;activeChatId=id/.test(s),
    'switchChat must NOT early-return on isStreaming (that blocked navigation during streams)'
  );
  assert.ok(
    /if\(artMatch&&activeChatId===originId\)/.test(s),
    'artifact panel must only auto-open when still viewing the origin chat'
  );
})();

// ── artifact panel closes on chat change ──────────────────────────────────────
// Why: the artifact panel from the previous chat stayed open when opening a new
// chat or switching chats. Both newChat and switchChat must close it.
(function artifactPanelCloses() {
  const s = appScript();
  assert.ok(
    /renderMessages\(\);closeArtifactPanel\(\);chatTitle\.textContent='New chat'/.test(s),
    'newChat must closeArtifactPanel()'
  );
  assert.ok(
    /renderMessages\(\);closeArtifactPanel\(\);\s*chatTitle\.textContent=chats\[id\]/.test(s),
    'switchChat must closeArtifactPanel()'
  );
})();

// ── mission-list dot is a dot, not a blob ─────────────────────────────────────
// Why: the mission dot is a <span>, so it matched `.chat-item span{flex:1}` (meant
// for the title) and grew to fill the row — a giant green blob. It must pin
// flex:0 0 auto so flex-grow can't stretch it.
(function missionDotNotBlob() {
  assert.ok(
    /border-radius:50%;flex:0 0 auto;background:/.test(APP),
    'mission dot must use flex:0 0 auto (flex-shrink:0 alone lets flex-grow stretch it)'
  );
  assert.ok(
    !/border-radius:50%;flex-shrink:0;background:\$\{dotColor/.test(APP),
    'the old flex-shrink:0 mission dot (blob bug) must not return'
  );
})();

// ── mission trigger stays owner-only ──────────────────────────────────────────
// Why: this session relaxed the deterministic mission trigger to any valid key,
// then reverted to owner-only by decision (the key is an owner key). Missions run
// with full owner tool access, so the trigger must stay gated on args.isOwner.
(function missionTriggerOwnerOnly() {
  assert.ok(
    /if \(args\.isOwner && !args\.background && _u\.length > 15 && CONTINUE_RX\.test\(_u\)/.test(GATEWAY),
    'deterministic mission trigger must stay gated on args.isOwner'
  );
})();

console.log('webapp-guards: all assertions passed');
