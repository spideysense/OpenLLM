import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp'), isPackaged: false },
  desktopCapturer: { getSources: vi.fn(async () => []) },
  screen: { getPrimaryDisplay: vi.fn(() => ({ workAreaSize: { width: 1280, height: 800 } })) },
}));
vi.mock('electron-store', () => ({
  default: class { constructor() { this._d = {}; } get(k, d) { return this._d[k] ?? d; } set(k, v) { this._d[k] = v; } },
}));

import * as validator from '../../src/main/code-validator.js';
const gatewayAgent = require('../../src/main/gateway-agent.js');

describe('code-validator', () => {
  it('flags the hallucinated chrome.commands.register API', () => {
    const r = validator.validateAnswer('```js\nchrome.commands.register({});\n```');
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/not a real API/i);
  });

  it('flags host patterns placed in permissions instead of host_permissions', () => {
    const r = validator.validateAnswer('```json\n{"manifest_version":3,"permissions":["activeTab","*://*/*"]}\n```');
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/host_permissions/i);
  });

  it('catches JavaScript syntax errors', () => {
    const r = validator.validateAnswer('```js\nfunction x(){ const y = ;\n```');
    expect(r.ok).toBe(false);
  });

  it('passes valid JS, JSX, and a correct MV3 manifest with no false positives', () => {
    expect(validator.validateAnswer('```js\nfunction add(a,b){return a+b;}\n```').ok).toBe(true);
    expect(validator.validateAnswer('```jsx\nexport default ()=> <div className="x">hi</div>;\n```').ok).toBe(true);
    expect(validator.validateAnswer('```json\n{"manifest_version":3,"permissions":["storage"],"host_permissions":["<all_urls>"],"background":{"service_worker":"bg.js"}}\n```').ok).toBe(true);
  });
});

describe('runValidated (validate-retry loop)', () => {
  it('retries broken code with the exact error and emits only the fixed version', async () => {
    let call = 0;
    async function* fakeRun(args) {
      call++;
      if (call === 1) {
        yield { type: 'content', text: '```js\nchrome.commands.register({});\n```' };
        yield { type: 'done' };
      } else {
        const fixMsg = args.messages[args.messages.length - 1].content;
        expect(fixMsg).toMatch(/not a real API/i);
        yield { type: 'content', text: '```js\nchrome.commands.onCommand.addListener(()=>{});\n```' };
        yield { type: 'done' };
      }
    }
    const args = { model: 'm', messages: [{ role: 'user', content: 'make a chrome extension' }] };
    let content = '';
    for await (const ev of gatewayAgent.runValidated(args, fakeRun)) {
      if (ev.type === 'content') content += ev.text;
    }
    expect(call).toBe(2);
    expect(content).toMatch(/onCommand\.addListener/);
    expect(content).not.toMatch(/commands\.register/);
  });

  it('does not retry clean code', async () => {
    let call = 0;
    async function* cleanRun() { call++; yield { type: 'content', text: '```js\nconst x=1;\n```' }; yield { type: 'done' }; }
    for await (const _ of gatewayAgent.runValidated({ messages: [{ role: 'user', content: 'write a js function' }] }, cleanRun)) { /* drain */ }
    expect(call).toBe(1);
  });

  it('passes non-coding turns straight through without buffering', async () => {
    let call = 0;
    async function* chatRun() { call++; yield { type: 'content', text: 'I am well.' }; yield { type: 'done' }; }
    const evs = [];
    for await (const ev of gatewayAgent.runValidated({ messages: [{ role: 'user', content: 'how are you' }] }, chatRun)) evs.push(ev);
    expect(call).toBe(1);
    expect(evs.some((e) => e.type === 'status' && /Writing and checking/.test(e.text))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Hardening for the recurring Chrome-extension failures that looped forever in
// the field (inline-script CSP, unsafe-inline, commands without description,
// Cmd/Option keybindings). Each is caught now so validate-retry fixes it.
// ─────────────────────────────────────────────────────────────────────────────
describe('code-validator — MV3 extension hardening', () => {
  it('flags an inline <script> that uses chrome.* in an extension HTML page', () => {
    const html =
      '```html\n<!DOCTYPE html><html><body>\n' +
      '<script>\nchrome.commands.onCommand.addListener(() => {});\n</script>\n' +
      '</body></html>\n```';
    const r = validator.validateAnswer(html);
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/inline <script>/i);
  });

  it('does NOT flag a plain inline <script> with no chrome APIs (ordinary HTML demo)', () => {
    const html =
      '```html\n<!DOCTYPE html><html><body>\n' +
      '<script>\ndocument.title = "hi";\n</script>\n</body></html>\n```';
    const r = validator.validateAnswer(html);
    expect(r.ok).toBe(true);
  });

  it('flags an external-script extension page as clean', () => {
    const html =
      '```html\n<!DOCTYPE html><html><body>\n<script src="popup.js"></script>\n</body></html>\n```';
    const r = validator.validateAnswer(html);
    expect(r.ok).toBe(true);
  });

  it('flags unsafe-inline in content_security_policy', () => {
    const json =
      '```json\n{ "manifest_version": 3, "name": "x", "version": "1", ' +
      '"content_security_policy": { "extension_pages": "script-src \'self\' \'unsafe-inline\'" } }\n```';
    const r = validator.validateAnswer(json);
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/unsafe-inline/i);
  });

  it('flags a manifest command missing a description', () => {
    const json =
      '```json\n{ "manifest_version": 3, "name": "x", "version": "1", ' +
      '"commands": { "open-drawer": { "suggested_key": { "default": "Ctrl+Shift+Y" } } } }\n```';
    const r = validator.validateAnswer(json);
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/needs a "description"/i);
  });

  it('does not flag _execute_action (it needs no description)', () => {
    const json =
      '```json\n{ "manifest_version": 3, "name": "x", "version": "1", ' +
      '"commands": { "_execute_action": { "suggested_key": { "default": "Ctrl+Shift+Y" } } } }\n```';
    const r = validator.validateAnswer(json);
    expect(r.problems.join(' ')).not.toMatch(/needs a "description"/i);
  });

  it('flags Cmd/Option in suggested_key (Chrome rejects them)', () => {
    const json =
      '```json\n{ "manifest_version": 3, "name": "x", "version": "1", ' +
      '"commands": { "go": { "description": "Go", "suggested_key": { "mac": "Cmd+Option+N" } } } }\n```';
    const r = validator.validateAnswer(json);
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/Command.*MacCtrl|not "Cmd" or "Option"/i);
  });

  it('still passes a correct, complete manifest with no problems', () => {
    const json =
      '```json\n{ "manifest_version": 3, "name": "Notes", "version": "1.0", ' +
      '"action": { "default_popup": "popup.html" }, ' +
      '"commands": { "open": { "description": "Open notes", "suggested_key": { "default": "Ctrl+Shift+Y", "mac": "Command+Shift+Y" } } } }\n```';
    const r = validator.validateAnswer(json);
    expect(r.ok).toBe(true);
  });
});

describe('CODING_RX — natural-language coding requests route to the coder', () => {
  const { CODING_RX } = require('../../src/main/model-router.js');
  it('classifies plain-English app/game requests as coding', () => {
    for (const t of [
      'create a web app game for guessing fonts',
      'make a game in a web app that is for users to guess fonts',
      'I want to make a simple web app like the iOS notes app',
      'build me a chrome extension',
    ]) expect(CODING_RX.test(t)).toBe(true);
  });
  it('does not misclassify ordinary chat as coding', () => {
    for (const t of [
      'what app should I use for taking notes',
      'write a poem about the ocean',
      'help me write a professional email to my boss',
    ]) expect(CODING_RX.test(t)).toBe(false);
  });
});
