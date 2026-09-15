const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aspen-household-'));
process.env.ASPEN_DATA_DIR = path.join(dir, 'data');
process.env.ASPEN_KEY_FILE = path.join(dir, 'credential');
fs.writeFileSync(process.env.ASPEN_KEY_FILE, crypto.randomBytes(32), { mode: 0o600 });
let service;
async function main() {
  const { secureFetch } = await import('../shared/secure-fetch.js');
  const v = require('../src/main/vault').get();
  const content = text => ({ name: 'home.txt', base64: Buffer.from(text).toString('base64') });
  const a = await v.ingest('alice', content('The house warranty reference is PRIVATE-123. Roof repair costs 4000 dollars.'));
  const b = await v.ingest('bob', content('The confidential allergy record mentions peanuts.'));
  assert.equal(v.list('owner').length, 0, 'household owner does not inherit private documents');
  assert.deepEqual(v.search('bob', 'warranty'), []);
  assert.throws(() => v.download('bob', a.id)); assert.throws(() => v.update('bob', a.id, { sharedWith: ['bob'] }));
  v.update('alice', a.id, { sharedWith: ['bob'] });
  assert.equal(v.search('bob', 'warranty')[0].documentId, a.id);
  assert.equal(v.download('alice', a.id).base64, content('The house warranty reference is PRIVATE-123. Roof repair costs 4000 dollars.').base64);
  assert.throws(() => v.grant('bob', { documentIds: [a.id], purpose: 'forward', audience: 'cloud' }));
  v.update('alice', a.id, { sharedWith: [] }); assert.deepEqual(v.search('bob', 'warranty'), []);
  const grant = v.grant('alice', { documentIds: [a.id], purpose: 'quote review', audience: 'Test client', maxChars: 25, maxRequests: 1 });
  const context = v.context(grant.token, 'warranty');
  assert.ok(context.results.reduce((n,r) => n+r.snippet.length, 0) <= 25);
  assert.throws(() => v.context(grant.token, 'warranty'), /exhausted/);
  assert.ok(!JSON.stringify(v.grants('alice')).includes(grant.token));
  assert.ok(!JSON.stringify(v.activity('alice')).includes('PRIVATE-123'));
  for (const file of fs.readdirSync(path.join(process.env.ASPEN_DATA_DIR, 'vault'))) {
    const raw = fs.readFileSync(path.join(process.env.ASPEN_DATA_DIR, 'vault', file), 'utf8');
    assert.ok(!raw.includes('PRIVATE-123')); assert.ok(!raw.includes('home.txt'));
  }
  const copy = v.snapshot(); v.remove('alice', a.id); assert.equal(v.list('alice').length, 0);
  assert.ok(!fs.existsSync(path.join(process.env.ASPEN_DATA_DIR, 'vault', a.id + '.json')));
  v.restore(copy); assert.equal(v.list('alice').length, 1); assert.equal(v.grants('alice').length, 0);
  const malformed = structuredClone(copy); malformed.contents[a.id].base64 = 'ZmFrZQ==';
  assert.throws(() => v.restore(malformed), /Invalid vault/); assert.equal(v.list('alice').length, 1);
  const expired = await v.ingest('alice', { ...content('temporary record'), retentionDays: 1 });
  const clock = Date.now; Date.now = () => clock() + 86400001;
  try { assert.ok(!v.list('alice').some(d => d.id === expired.id)); } finally { Date.now = clock; }
  await assert.rejects(v.ingest('alice', { name: '../payload.exe', base64: 'aGVsbG8=' }), /Supported files/);
  const index = path.join(process.env.ASPEN_DATA_DIR, 'vault/index.json'); const indexBytes = fs.readFileSync(index);
  fs.writeFileSync(index, 'corrupt'); assert.throws(() => v.list('alice')); fs.writeFileSync(index, indexBytes);
  // Exercise the real gateway, service, WebCrypto transport, and scoped routes.
  service = await require('../src/main/service').start({ port: 0, engine: false });
  const base = `http://127.0.0.1:${service.port}`;
  const keys = require('../src/main/apikeys');
  const owner = keys.listKeys().find(k => k.owner);
  const alice = keys.createKey('Alice', { userId: 'alice', memory: true });
  const bob = keys.createKey('Bob', { userId: 'bob' });
  const api = async (token, route, body) => { const r = await secureFetch(base, token, route, { method: body ? 'POST' : 'GET', body }); return { status: r.status, value: await r.json() }; };
  assert.equal((await api(bob.secret, '/v1/household')).status, 403);
  assert.equal((await api(alice.secret, '/v1/vault')).value.documents.length, 1);
  assert.equal((await api(owner.secret, '/v1/vault')).value.documents.length, 0);
  const scoped = v.grant('alice', { documentIds: [a.id], purpose: 'Quote review', audience: 'Client' });
  assert.equal((await api(scoped.token, '/v1/context', { query: 'warranty' })).value.results[0].documentId, a.id);
  await assert.rejects(api(scoped.token, '/v1/vault'), /Secure connection/);
  await assert.rejects(api(scoped.token, '/v1/agent', { messages: [{ role: 'user', content: 'hi' }] }), /Secure connection/);
  v.revoke('alice', scoped.id); await assert.rejects(api(scoped.token, '/v1/context', { query: 'warranty' }));
  const raw = await fetch(base + '/v1/vault', { headers: { Authorization: `Bearer ${owner.secret}` } }); assert.equal(raw.status, 403);
  const page = await fetch(base + '/household'); assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.ok(!Object.keys(require.cache).some(f => /node_modules[/\\]electron[/\\]/.test(f)), 'service must not load Electron');
  // Atomic process lock denies a second writer before it can open the profile.
  const lockProbe = `require('proper-lockfile').lock(process.env.ASPEN_DATA_DIR,{retries:0}).then(()=>process.exit(2),()=>process.exit(0))`;
  execFileSync(process.execPath, ['-e', lockProbe], { cwd: path.resolve(__dirname, '..'), env: process.env });
  const execution = require('../src/main/execution-context'), policy = require('../src/main/tool-policy');
  execution.run({ person: 'alice' }, () => {
    execution.markPrivate(); assert.equal(policy.allowed('web_search', { isOwner: true }), false); assert.equal(policy.allowed('run_command', { isOwner: true }), false); assert.equal(policy.allowed('vault_search'), true);
  });
  assert.equal(policy.allowed('web_search'), true, 'private context does not contaminate the next request');
  const backup = require('../src/main/backup'), password = 'test-household-backup-password';
  const saved = await backup.exportBackup(password); v.remove('alice', a.id);
  await backup.importBackup(saved, password); assert.equal(v.list('alice').length, 1);
  assert.ok(!keys.validateKey(alice.secret)); assert.equal(v.grants('alice').length, 0);
  assert.equal(v.download('bob', b.id).sha256, b.sha256);
  console.log('Household integration passed: ownership, encrypted storage, scoped context, expiry, deletion, restoration, actual HTTP, service isolation, profile lock, and local-only tool boundary.');
}
main().then(async () => { await service?.stop(); fs.rmSync(dir, { recursive: true, force: true }); process.exit(0); }).catch(async error => { console.error(error); await service?.stop(); fs.rmSync(dir, { recursive: true, force: true }); process.exit(1); });
