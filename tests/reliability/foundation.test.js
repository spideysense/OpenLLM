import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { TextDecoder, TextEncoder } from 'node:util';
const require = createRequire(import.meta.url);
const root = path.join(process.cwd(), 'src/main');
function load(name, mocks = {}, globals = {}) {
  const module = { exports: {} };
  const local = createRequire(path.join(root, name));
  vm.runInNewContext(fs.readFileSync(path.join(root, name), 'utf8'), { module, exports: module.exports,
    require: id => Object.hasOwn(mocks, id) ? mocks[id] : local(id), Buffer, TextDecoder, TextEncoder,
    structuredClone, AbortController, AbortSignal, setTimeout, clearTimeout, console, process, ...globals });
  return module.exports;
}
function memoryStore(initial = {}) { let data = structuredClone(initial); return {
  get: key => structuredClone(key === undefined ? data : data[key]),
  set: (key, value) => { data[key] = structuredClone(value); }, replace: value => { data = structuredClone(value); }
}; }

describe('durable local records', () => {
  it('recovers the last valid version without overwriting corrupt evidence', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aspen-records-'));
    try {
      const records = load('durable-json.js', { electron: {} }); const file = path.join(dir, 'data.json');
      records.write(file, { n: 1 }); records.write(file, { n: 2 }); fs.writeFileSync(file, '{broken');
      expect(records.read(file, {})).toEqual({ n: 1 });
      expect(fs.readFileSync(file, 'utf8')).toBe('{broken');
      fs.writeFileSync(file + '.bak', '{also broken');
      expect(() => records.read(file, {})).toThrow(/preserved/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('encrypts primary and backup with the OS keystore when available', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aspen-records-'));
    try {
      const secure = { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s).reverse(), decryptString: b => b.reverse().toString() };
      const records = load('durable-json.js', { electron: { safeStorage: secure } }, { process: { versions: { electron: 'test' } } }); const file = path.join(dir, 'data');
      fs.writeFileSync(file, '{"secret":"old private fact"}'); records.write(file, { secret: 'new private fact' });
      for (const p of [file, file + '.bak']) { expect(fs.readFileSync(p, 'utf8')).not.toContain('private fact'); expect(fs.statSync(p).mode & 0o777).toBe(0o600); }
      expect(records.read(file, {})).toEqual({ secret: 'new private fact' });
      secure.isEncryptionAvailable = () => false;
      expect(() => records.read(file, {})).toThrow(/keychain/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('does not commit failed settings writes or expose mutable references', () => {
    const records = { read: () => ({ value: { n: 1 } }), write: vi.fn(() => { throw new Error('disk full'); }) };
    const store = load('store.js', { './durable-json': records }); store.get('value').n = 42;
    expect(() => store.set('value', { n: 2 })).toThrow('disk full'); expect(store.get('value')).toEqual({ n: 1 });
    expect(() => store.set('__proto__', {})).toThrow();
  });
  it('retains conversations and messages beyond the old limits', () => {
    let archive = []; const c = load('conversations.js', { './durable-json': { read: () => archive, write: (_, value) => { archive = structuredClone(value); } } });
    const input = Array.from({ length: 60 }, (_, id) => ({ id, messages: Array.from({ length: 250 }, () => ({ role: 'user', content: 'hello' })) }));
    c.save(input); expect(c.load()).toEqual(input);
  });
});

describe('permissions follow the live identity and exact tool offer', () => {
  it('denies owner tools to guests, disabled tools to owners, and unoffered calls', () => {
    let enabled = ['run_command', 'web_search', 'computer_use'];
    const policy = load('tool-policy.js', { './tool-settings': { getEnabledToolNames: () => enabled } });
    for (const name of ['run_command', 'git_status', 'computer_click', 'github__list_repos', 'publish_app']) expect(policy.allowed(name, { isOwner: false })).toBe(false);
    expect(policy.allowed('web_search', { offered: new Set(['calculate']) })).toBe(false);
    expect(policy.allowed('computer_click', { isOwner: true })).toBe(false);
    expect(policy.allowed('computer_click', { isOwner: true, allowComputerUse: true })).toBe(true);
    enabled = []; expect(policy.allowed('run_command', { isOwner: true })).toBe(false);
  });
  it('never opens an empty key store; rotation preserves a person’s memory identity', () => {
    const store = memoryStore(); const keys = load('apikeys.js', { './store': store });
    expect(keys.validateKey('anything')).toBe(false); expect(keys.memoryKeyFor('anything')).toBeNull();
    const guest = keys.createKey('Family', { memory: true }); const oldSecret = guest.secret;
    const rotated = keys.rotateKey(guest.id); expect(keys.validateKey(oldSecret)).toBe(false);
    expect(keys.memoryKeyFor(rotated.secret)).toBe(guest.userId); expect(keys.isOwnerKey(rotated.secret)).toBe(false);
    const anonymous = keys.createKey('Visitor'); expect(keys.memoryKeyFor(anonymous.secret)).toBeNull();
  });
});

describe('stream framing', () => {
  it('decodes every byte boundary including split Unicode and final records', () => {
    const { NDJSON } = load('ndjson.js'); const p = new NDJSON(); const bytes = Buffer.from('{"text":"家🌲"}\n{"done":true}');
    const out = [...bytes].flatMap(b => p.push(Uint8Array.of(b))); out.push(...p.push(undefined, true));
    expect(out).toEqual([{ text: '家🌲' }, { done: true }]);
  });
  it('rejects malformed final records instead of reporting success', () => {
    const { NDJSON } = load('ndjson.js'); const p = new NDJSON(); p.push(Buffer.from('{"done":'));
    expect(() => p.push(undefined, true)).toThrow();
  });
});

function serviceFixture(generator, initial = {}) {
  const store = memoryStore(initial); let archive = [];
  const conversations = { load: () => structuredClone(archive), upsert: c => { const i = archive.findIndex(x => x.id === c.id); if (i < 0) archive.push(structuredClone(c)); else archive[i] = structuredClone(c); } };
  const service = load('chat-service.js', { './store': store, './conversations': conversations,
    './gateway-agent': { runValidated: generator }, './cloud': { syncFromStore() {}, autoFallback: async () => null }, './admission': { acquire: async () => () => {} }, './execution-context': { run: (_, f) => f() } });
  return { service, store, conversations, clear: () => { archive = []; } };
}
const input = id => ({ model: 'test:7b', convoId: id, messages: [{ role: 'system', content: 'Answer in French.' }, { role: 'user', content: 'hello' }] });

describe('durable chat lifecycle', () => {
  it('persists the user before execution and the completed response without a renderer', async () => {
    let fixture; fixture = serviceFixture(async function* (args) {
      expect(fixture.conversations.load()[0].messages).toEqual(input(1).messages);
      expect(args.messages.some(m => m.content === 'Answer in French.')).toBe(true);
      yield { type: 'content', text: 'Bonjour' };
    });
    const events = []; fixture.service.events.on('stream', e => events.push(e));
    expect((await fixture.service.send(input(1))).success).toBe(true);
    expect(fixture.conversations.load()[0].messages.at(-1).content).toBe('Bonjour');
    expect(events.every(e => e.convoId === 1 && e.requestId && e.seq > 0)).toBe(true);
    expect(events.at(-1).done).toBe(true); expect(fixture.service.snapshot()[0].buffer).toBe('Bonjour');
  });
  it('stops only the requested chat and saves its partial response', async () => {
    const started = new Map(); const f = serviceFixture(async function* ({ signal, messages }) {
      const id = messages.at(-1).content; yield { type: 'content', text: id };
      await new Promise(resolve => { started.set(id, resolve); signal.addEventListener('abort', resolve, { once: true }); });
      signal.throwIfAborted(); yield { type: 'content', text: ' finished' };
    });
    const a = f.service.send({ ...input(1), messages: [{ role: 'user', content: 'a' }] });
    const b = f.service.send({ ...input(2), messages: [{ role: 'user', content: 'b' }] });
    await vi.waitFor(() => expect(started.size).toBe(2)); f.service.stop(1);
    expect((await a).aborted).toBe(true); started.get('b')(); expect((await b).success).toBe(true);
    expect(f.conversations.load().map(c => c.messages.at(-1).content)).toEqual(['a', 'b finished']);
  });
  it('does not resurrect deleted work when cancellation finishes', async () => {
    let started = false; const f = serviceFixture(async function* ({ signal }) { yield { type: 'content', text: 'private' }; started = true; await new Promise(resolve => signal.addEventListener('abort', resolve)); });
    const done = f.service.send(input(1)); await vi.waitFor(() => expect(started).toBe(true));
    f.service.forgetAll(); f.clear(); await done; expect(f.service.snapshot()).toEqual([]); expect(f.conversations.load()).toEqual([]);
  });
  it('recovers interrupted partial responses exactly once', () => {
    const f = serviceFixture(async function* () {}, { chatJobs: { 1: { convoId: 1, requestId: 'r', buffer: 'partial', trail: [], seq: 2, done: false } } });
    f.conversations.upsert({ id: 1, messages: [] }); f.service.snapshot(); f.service.snapshot();
    const replies = f.conversations.load()[0].messages; expect(replies).toHaveLength(1); expect(replies[0].content).toBe('partial'); expect(replies[0].error).toMatch(/restarted/);
  });
  it('emits a terminal error even when the final disk write fails, and permits retry', async () => {
    let fail = true; const f = serviceFixture(async function* () { yield { type: 'content', text: 'answer' }; if (fail) f.conversations.upsert = () => { throw new Error('disk full'); }; });
    const events = []; f.service.events.on('stream', e => events.push(e));
    expect((await f.service.send(input(1))).error).toMatch(/disk full/); expect(events.at(-1).done).toBe(true);
    fail = false; f.conversations.upsert = () => {}; expect((await f.service.send(input(1))).success).toBe(true);
  });
});

describe('resource admission', () => {
  it('queues to the hardware limit and removes aborted waiters', async () => {
    const gate = load('admission.js', { './system': { getRuntimeBudget: () => ({ parallel: 1 }) } });
    const release = await gate.acquire(); const controller = new AbortController();
    const aborted = gate.acquire(controller.signal); controller.abort(); await expect(aborted).rejects.toBeTruthy();
    let acquired = false; const queued = gate.acquire().then(r => { acquired = true; return r; });
    await Promise.resolve(); expect(acquired).toBe(false); release(); const nextRelease = await queued;
    release(); nextRelease();
  });
});

describe('encrypted backup recovery', () => {
  it('restores data, rejects wrong passwords and tampering, and completes interrupted restores', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aspen-backup-'));
    try {
      const store = memoryStore({ apikeys: [{ id: 'family', userId: 'person', secret: 'old-device-key' }], worldModel: { facts: ['private family fact'] }, connectorTokens: { github: 'old-device-keychain-blob' } });
      let archive = [{ id: 1, messages: [{ role: 'user', content: 'private history' }] }];
      let failSave = false;
      const records = load('durable-json.js', { electron: {} });
      const backup = load('backup.js', { os: { homedir: () => dir }, './durable-json': records, './store': store,
        './conversations': { load: () => archive, save: value => { if (failSave) throw new Error('interrupted'); archive = value; } } });
      const password = 'long unique recovery password'; const encrypted = await backup.exportBackup(password);
      expect(encrypted).not.toContain('private'); store.replace({ changed: true }); archive = [];
      await expect(backup.importBackup(encrypted, 'wrong backup password')).rejects.toBeTruthy(); expect(store.get()).toEqual({ changed: true });
      const tampered = JSON.parse(encrypted); tampered.data = Buffer.from('corrupt').toString('base64');
      await expect(backup.importBackup(JSON.stringify(tampered), password)).rejects.toBeTruthy();
      failSave = true; await expect(backup.importBackup(encrypted, password)).rejects.toThrow('interrupted');
      expect(fs.existsSync(path.join(dir, '.aspen/restore.pending.json'))).toBe(true);
      failSave = false; backup.recover();
      expect(store.get('apikeys')[0].secret).not.toBe('old-device-key'); expect(store.get('apikeys')[0].userId).toBe('person');
      expect(store.get('worldModel').facts).toEqual(['private family fact']); expect(store.get('connectorTokens')).toBeUndefined();
      expect(archive[0].messages[0].content).toBe('private history'); expect(fs.existsSync(path.join(dir, '.aspen/restore.pending.json'))).toBe(false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('foreground priority and explicit cloud consent', () => {
  it('preempts background work and gives the next slot to a person', async () => {
    const gate = load('admission.js', { './system': { getRuntimeBudget: () => ({ parallel: 1 }) } });
    let preempted = false; const release = await gate.acquire(undefined, { background: true, onPreempt: () => { preempted = true; } });
    const background = gate.acquire(undefined, { background: true });
    const foreground = gate.acquire(); expect(preempted).toBe(true); release();
    const releaseForeground = await foreground; let backgroundRunning = false;
    background.then(r => { backgroundRunning = true; r(); }); await Promise.resolve(); expect(backgroundRunning).toBe(false);
    releaseForeground(); await background; expect(backgroundRunning).toBe(true);
  });
  it('allows explicit owner boost only and marks cloud responses', async () => {
    let enabled = false, calls = 0;
    const service = load('chat-service.js', { './gateway-agent': {}, './store': {}, './conversations': {},
      './cloud': { syncFromStore() {}, enabled: () => enabled, boost: async () => { calls++; return { text: 'answer', provider: 'test', marker: ' left this device' }; } } });
    const collect = async args => { const out = []; for await (const event of service.run(args)) out.push(event); return out; };
    await expect(collect({ boost: true, isOwner: false })).rejects.toThrow(/owner/);
    await expect(collect({ boost: true, isOwner: true })).rejects.toThrow(/Settings/); expect(calls).toBe(0);
    enabled = true; const events = await collect({ boost: true, isOwner: true, messages: [] });
    expect(events[0].name).toBe('cloud:test'); expect(events[1].text).toContain('left this device'); expect(calls).toBe(1);
  });
});
