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
