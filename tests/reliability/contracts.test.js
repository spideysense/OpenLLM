import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { TextEncoder, TextDecoder } from 'node:util';
const require = createRequire(import.meta.url);
function load(name, mocks = {}, globals = {}, expose = '') {
  const module = { exports: {} }, filename = path.resolve('src/main', name);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8') + '\n' + expose, {
    module, exports: module.exports, __dirname: path.dirname(filename),
    require: id => Object.hasOwn(mocks, id) ? mocks[id] : id.startsWith('.') ? {} : require(id),
    Buffer, URL, TextDecoder, TextEncoder, AbortController, AbortSignal, structuredClone, fetch,
    setTimeout, clearTimeout, setImmediate, setInterval: () => ({ unref() {} }), clearInterval() {},
    process: { ...process, env: {}, on() {} }, console: { log() {}, error() {}, warn() {} }, ...globals,
  });
  return module.exports;
}
function memoryStore() { let data = {}; return { get: k => structuredClone(k === undefined ? data : data[k]), set: (k,v) => { data[k] = structuredClone(v); }, replace: v => { data = v; } }; }

describe('real main-process IPC contracts', () => {
  function fixture() {
    const handlers = {}, store = memoryStore();
    const keys = load('apikeys.js', { './store': store });
    load('index.js', { electron: { app: { isPackaged: true, whenReady: () => new Promise(() => {}), on() {} }, ipcMain: { handle: (k,v) => { handlers[k] = v; } } },
      './store': store, './apikeys': keys, './chat-service': { events: new EventEmitter() },
      './settings-schema': require('../../src/main/settings-schema.js') });
    return { handlers, store, keys };
  }
  it('family invitations preserve requested memory scope', async () => {
    const { handlers, keys } = fixture(); const key = await handlers['apikeys:create']({}, 'Family', { owner: false, memory: true });
    expect(key.owner).toBe(false); expect(key.memory).toBe(true); expect(keys.memoryKeyFor(key.secret)).toBe(key.userId);
  });
  it('persists supported UI settings and rejects malformed values visibly', async () => {
    const { handlers, store } = fixture();
    const settings = { cloudMode: 'boost', cloudKeys: { OPENAI_API_KEY: 'test' }, modelAutonomy: 'rankings', pendingPrompt: 'hello' };
    for (const [key, value] of Object.entries(settings)) { await handlers['store:set']({}, key, value); expect(store.get(key)).toEqual(value); }
    await expect(handlers['store:set']({}, 'cloudMode', 'invented')).rejects.toThrow();
    await expect(handlers['store:set']({}, 'apikeys', [])).rejects.toThrow();
  });
  it('does not expose the entire configuration or internal credentials', async () => {
    const { handlers, store } = fixture(); store.set('apikeys', [{ secret: 'private' }]);
    for (const key of [undefined, 'apikeys', 'connectorTokens', 'chatJobs']) await expect(handlers['store:get']({}, key)).rejects.toThrow();
  });
});

describe('actual gateway authorization', () => {
  it('blocks guest missions, publishing and arbitrary engine routes while scoping memory', async () => {
    let handler; const forwarded = [];
    const server = { listen() {}, on() {} };
    const gateway = load('gateway.js', { http: { createServer: cb => { handler = cb; return server; }, request: options => { forwarded.push(options); throw new Error('must not proxy'); } },
      fs: { mkdirSync() {}, existsSync: () => false }, electron: { app: { getPath: () => '/tmp' } },
      './store': memoryStore(), './aliases': { resolve: x => x },
      './apikeys': { listKeys: () => [{ secret: 'guest' }], validateKey: t => t === 'guest', touchKey() {}, isOwnerKey: () => false, memoryKeyFor: () => 'guest-id' },
      './world-model': { getFacts: id => { expect(id).toBe('guest-id'); return ['guest fact']; } },
    }); gateway.start();
    async function request(url, method, body) {
      const req = new EventEmitter(); Object.assign(req, { url, method, headers: { authorization: 'Bearer guest' }, socket: { remoteAddress: 'test' } });
      const res = new EventEmitter(); res.setHeader = () => {}; res.writeHead = status => { res.status = status; }; res.end = body => { res.body = body; };
      handler(req, res); if (body) req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end'); await Promise.resolve(); return res;
    }
    for (const [url, method] of [['/missions','GET'], ['/missions/stop','POST'], ['/publish-artifact','POST'], ['/api/delete','DELETE'], ['/api/pull','POST']]) {
      const res = await request(url, method, {}); expect([401,403,404]).toContain(res.status);
    }
    const memory = await request('/v1/world-model', 'GET'); expect(memory.status).toBe(200); expect(JSON.parse(memory.body).facts).toEqual(['guest fact']); expect(forwarded).toEqual([]);
  });
});

describe('model download and promotion contracts', () => {
  function models(chunks, installed = []) {
    return load('models.js', { './ndjson': require('../../src/main/ndjson.js'), './model-id': require('../../src/main/model-id.js') }, {
      fetch: async url => url.endsWith('/api/tags') ? { ok: true, json: async () => ({ models: installed }) } : {
        ok: true, body: (async function* () { for (const c of chunks) yield Buffer.from(c); })() },
    });
  }
  it('rejects a split in-stream error and premature EOF', async () => {
    expect((await models(['{"error":"disk', ' full"}\n']).pullModel('test:7b')).error).toBe('disk full');
    expect((await models(['{"status":"pulling manifest"}\n']).pullModel('test:7b')).success).toBe(false);
  });
  it('requires the exact installed tag after final success', async () => {
    const chunks = ['{"sta', 'tus":"success"}'];
    expect((await models(chunks, [{ name: 'test:3b' }]).pullModel('test:7b')).success).toBe(false);
    expect((await models(chunks, [{ name: 'test:7b' }]).pullModel('test:7b')).success).toBe(true);
  });
  it('downloads and tests a new tag even if its family is installed, and retains the old default on failure', async () => {
    const research = load('model-research.js', { './model-id': require('../../src/main/model-id.js') });
    const pull = vi.fn(), smoke = vi.fn(async () => false), promote = vi.fn();
    const candidate = { model: 'qwen3:32b', tool_support: true, approx_gb: 20, min_tier: 'heavy' };
    const result = await research.runRefresh('full', { tierCapGB: 25, checkResolvable: false,
      trustedCatalog: { models: [{ ...candidate, download_gb: 20 }] }, searchFn: async () => 'evidence', chatFn: async () => JSON.stringify([candidate]),
      getRegistry: async () => ({ models: [] }), saveRegistry: async () => {}, installed: [{ name: 'qwen3:4b' }], pullModel: pull, smokeTest: smoke, setActive: promote });
    expect(pull).toHaveBeenCalledWith('qwen3:32b'); expect(smoke).toHaveBeenCalledWith('qwen3:32b'); expect(promote).not.toHaveBeenCalled(); expect(result.swappedTo).toBeNull();
  });
});

describe('actual tool dispatch', () => {
  it('blocks fabricated calls outside the offered set and all guest connector access', async () => {
    const execute = vi.fn(); const policy = load('tool-policy.js', { './tool-settings': { getEnabledToolNames: () => ['calculate', 'run_command'] } });
    const gateway = load('gateway-agent.js', { './tool-policy': policy, './tools': { executeTool: execute }, './execution-context': { check() {} } }, {}, 'module.exports.dispatchForTest = executeAnyTool;');
    await gateway.dispatchForTest('run_command', { command: 'must-not-run' }, true, new Set(['calculate']));
    await gateway.dispatchForTest('github__create_issue', {}, false, new Set(['github__create_issue']));
    expect(execute).not.toHaveBeenCalled();
    await gateway.dispatchForTest('calculate', { expression: '2+2' }, false, new Set(['calculate']));
    expect(execute).toHaveBeenCalledOnce();
  });
});
