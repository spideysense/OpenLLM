'use strict';
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { Vault } = require('./store');
const intelligence = require('./intelligence');
const { draftPlan } = require('./plans');
const { haRequest, visibleDevices, validateLocalUrl } = require('./integrations');
const scrypt = promisify(crypto.scrypt);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const token = () => crypto.randomBytes(32).toString('base64url');
const id = () => crypto.randomUUID();
const APPS = [
  { id: 'butler', name: 'Butler', description: 'Tasks & reminders.', capabilities: ['Tasks and reminders', 'Authorized household memory'], available: true },
  { id: 'secure', name: 'Secure', description: 'Door & motion sensors.', capabilities: ['Approved door and motion sensors'], available: true },
  { id: 'energy', name: 'Energy', description: 'Energy & temperature.', capabilities: ['Approved energy and climate readings'], available: true },
];
const CLIENT_SCOPES = ['home:read', 'chat:ask', 'tasks:write', 'devices:control'];
const fail = (message, status = 400) => { const e = new Error(message); e.status = status; throw e; };
const text = (v, name, max = 200) => typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : fail('Please enter ' + name + '.');
const passwords = async password => { const salt = token(); return { salt, password: (await scrypt(password, salt, 64)).toString('hex') }; };
const requirePassword = v => typeof v === 'string' && v.length >= 12 && v.length <= 256 ? v : fail('Use a password with 12 to 256 characters.');
const canRead = (item, member) => item.visibility === 'household' || item.ownerId === member.id;

async function createHomeServer(options = {}) {
  const host = options.host || '127.0.0.1';
  const tls = options.tls;
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !tls) throw new Error('Network access requires HTTPS. Configure a TLS certificate and key.');
  const vault = new Vault(options.dataDir || path.join(os.homedir(), '.aspen', 'home'), options.vaultOptions);
  const state = vault.state;
  const sessions = new Map(), invitations = new Map(), pairings = new Map(), attempts = new Map(), pendingChat = new Set();
  const plans = new Map();
  const bootstrap = token();
  let origin = '';
  const model = options.intelligence || intelligence;
  const ha = options.haRequest || haRequest;
  const owner = auth => auth.member.role === 'owner' && !auth.client || fail('Only the household owner can change this.', 403);
  const human = auth => !auth.client || fail('Use the Aspen app for this change.', 403);
  const scope = (auth, value) => !auth.client || auth.client.scopes.includes(value) || fail('This device does not have that permission.', 403);
  const session = (memberId, res) => {
    const secret = token(); sessions.set(hash(secret), { memberId, expires: Date.now() + 12 * 3600000 });
    res.setHeader('Set-Cookie', `aspen_session=${secret}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${tls ? '; Secure' : ''}`);
  };
  function authenticate(req) {
    let entry, client;
    const bearer = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{40,60})$/)?.[1];
    if (bearer) { client = state.clients.find(c => c.keyHash === hash(bearer) && !c.revokedAt); entry = client && { memberId: client.memberId }; }
    else {
      const cookie = (req.headers.cookie || '').match(/(?:^|; )aspen_session=([A-Za-z0-9_-]+)/)?.[1];
      entry = cookie && sessions.get(hash(cookie));
      if (entry?.expires < Date.now()) { sessions.delete(hash(cookie)); entry = null; }
    }
    const member = entry && state.members.find(m => m.id === entry.memberId && !m.disabled);
    if (!member) fail('Please sign in to your home.', 401);
    return { member, client };
  }
  function publicState(auth) {
    const { member, client } = auth;
    const rooms = client?.roomId ? state.rooms.filter(r => r.id === client.roomId) : state.rooms;
    const devices = state.devices.filter(d => d.enabled && (!client?.roomId || d.roomId === client.roomId));
    return {
      household: state.household, me: { id: member.id, name: member.name, role: member.role },
      members: state.members.filter(m => !m.disabled).map(m => ({ id: m.id, name: m.name, role: m.role })), rooms,
      memories: state.memories.filter(m => client ? m.visibility === 'household' : canRead(m, member)),
      tasks: state.tasks.filter(t => client ? t.visibility === 'household' : canRead(t, member)),
      apps: APPS.map(a => ({ ...a, installed: state.apps.includes(a.id) })), devices,
      clients: member.role === 'owner' && !client ? state.clients.map(({ keyHash, ...c }) => c) : [],
      events: member.role === 'owner' && !client ? state.events : [],
      connections: { homeAssistant: !!state.connections.ha },
      privacy: { inference: 'local-only', cloudEnabled: false, microphoneEnabled: false },
    };
  }
  async function readBody(req) {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) fail('Expected JSON.', 415);
    let body = '';
    for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 24000) fail('Request too large.', 413); }
    try { const parsed = JSON.parse(body || '{}'); if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') fail('Expected a JSON object.'); return parsed; }
    catch { fail('Invalid request.'); }
  }
  function limit(req, bucket, max = 12) {
    const key = bucket + ':' + req.socket.remoteAddress;
    const last = attempts.get(key);
    const item = last && last.until > Date.now() ? last : { count: 0, until: Date.now() + 60000 };
    attempts.set(key, item);
    if (++item.count > max) fail('Please wait a minute and try again.', 429);
  }
  function visibility(value) { return value === 'household' ? 'household' : 'private'; }
  function due(value) {
    if (!value) return null;
    const parsed = new Date(value);
    if (!Number.isFinite(+parsed)) fail('Choose a valid date and time.');
    return parsed.toISOString();
  }
  async function api(req, res, route) {
    const method = req.method;
    const b = ['POST', 'PATCH', 'DELETE'].includes(method) ? await readBody(req) : {};
    if (route === 'status' && method === 'GET') return { setup: !!state.household, product: 'Aspen', version: 'home-preview-1', local: true };
    if (route === 'setup' && method === 'POST') {
      limit(req, 'setup');
      if (state.household) fail('This home is already set up.', 409);
      if (typeof b.bootstrap !== 'string' || hash(b.bootstrap) !== hash(bootstrap)) fail('Open Aspen using the setup link on this computer.', 403);
      const name = text(b.name, 'your name', 80), homeName = text(b.homeName, 'a name for your home', 80);
      const auth = await passwords(requirePassword(b.password));
      // Re-check after asynchronous password hashing to prevent double claims.
      if (state.household) fail('This home is already set up.', 409);
      const member = { id: id(), name, role: 'owner', ...auth };
      state.members.push(member);
      state.household = { id: id(), name: homeName, createdAt: new Date().toISOString() };
      state.rooms = ['Living room', 'Kitchen', 'Bedroom'].map(name => ({ id: id(), name }));
      vault.audit(member.id, 'home.created', state.household.id); vault.save(); session(member.id, res);
      return { ok: true };
    }
    if (route === 'login' && method === 'POST') {
      limit(req, 'login', 8);
      const member = state.members.find(m => m.name.toLowerCase() === String(b.name).trim().toLowerCase() && !m.disabled);
      const secret = typeof b.password === 'string' && b.password.length <= 256 ? b.password : '';
      const derived = await scrypt(secret, member?.salt || 'aspen-no-member', 64);
      if (!member || !crypto.timingSafeEqual(derived, Buffer.from(member.password, 'hex'))) fail('The name or password did not match.', 401);
      session(member.id, res); return { ok: true };
    }
    if (route === 'join' && method === 'POST') {
      limit(req, 'join');
      const invite = invitations.get(hash(String(b.invite || '')));
      if (!invite || invite.expires < Date.now()) fail('This invitation has expired. Ask for a new one.', 403);
      const name = text(b.name, 'your name', 80);
      if (state.members.some(m => m.name.toLowerCase() === name.toLowerCase())) fail('That name is already used in this home.');
      const auth = await passwords(requirePassword(b.password));
      if (invitations.get(hash(String(b.invite))) !== invite || invite.expires < Date.now()) fail('This invitation has already been used or expired.', 403);
      if (state.members.some(m => m.name.toLowerCase() === name.toLowerCase())) fail('That name is already used in this home.');
      invitations.delete(hash(b.invite));
      const member = { id: id(), name, role: invite.role, ...auth }; state.members.push(member);
      vault.audit(member.id, 'member.joined', member.id); vault.save(); session(member.id, res); return { ok: true };
    }
    if (route === 'pair' && method === 'POST') {
      limit(req, 'pair');
      const pairing = pairings.get(hash(String(b.code || '')));
      if (!pairing || pairing.expires < Date.now()) fail('This pairing code has expired or was already used.', 403);
      pairings.delete(hash(b.code));
      const secret = token();
      const client = { id: id(), name: pairing.name, type: pairing.type, scopes: pairing.scopes, roomId: pairing.roomId, memberId: pairing.memberId, keyHash: hash(secret), createdAt: new Date().toISOString() };
      state.clients.push(client); vault.audit(client.memberId, 'device.paired', client.id); vault.save();
      return { token: secret, client: { id: client.id, scopes: client.scopes, roomId: client.roomId } };
    }
    const auth = authenticate(req), member = auth.member;
    if (route === 'state' && method === 'GET') { scope(auth, 'home:read'); return publicState(auth); }
    if (route === 'models' && method === 'GET') { owner(auth); return model.inspectModels(); }
    if (route === 'models/prepare' && method === 'POST') { owner(auth); return model.prepare(); }
    if (route === 'logout' && method === 'POST') {
      const cookie = (req.headers.cookie || '').match(/(?:^|; )aspen_session=([A-Za-z0-9_-]+)/)?.[1];
      if (cookie) sessions.delete(hash(cookie));
      res.setHeader('Set-Cookie', `aspen_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${tls ? '; Secure' : ''}`); return { ok: true };
    }
    if (route === 'invites' && method === 'POST') {
      owner(auth);
      if (!['adult', 'child', 'guest'].includes(b.role)) fail('Choose a family role.');
      const invite = token(), expires = Date.now() + 15 * 60000;
      invitations.set(hash(invite), { role: b.role, expires }); return { invite, expires, url: origin + '/#join=' + invite };
    }
    if (route === 'members' && method === 'DELETE') {
      owner(auth); const target = state.members.find(m => m.id === b.id && m.role !== 'owner');
      if (!target) fail('Family member not found.', 404);
      target.disabled = true;
      state.clients.filter(c => c.memberId === target.id).forEach(c => { c.revokedAt = new Date().toISOString(); });
      vault.audit(member.id, 'member.removed', target.id); vault.save(); return { ok: true };
    }
    if (route === 'rooms' && method === 'POST') {
      owner(auth); const name = text(b.name, 'a room name', 80);
      if (state.rooms.length >= 50) fail('Your home has reached the room limit.');
      if (state.rooms.some(r => r.name.toLowerCase() === name.toLowerCase())) fail('That room already exists.');
      state.rooms.push({ id: id(), name }); vault.save(); return { ok: true };
    }
    if (route === 'memories' && method === 'POST') {
      human(auth); if (member.role === 'guest') fail('Guests cannot add household memory.', 403);
      if (state.memories.length >= 1000) fail('The memory limit has been reached.');
      state.memories.unshift({ id: id(), text: text(b.text, 'something to remember', 2000), visibility: visibility(b.visibility), ownerId: member.id, at: new Date().toISOString() });
      vault.save(); return { ok: true };
    }
    if (route === 'memories' && method === 'DELETE') {
      human(auth); const index = state.memories.findIndex(m => m.id === b.id && m.ownerId === member.id);
      if (index < 0) fail('You can delete only memories you added.', 403);
      state.memories.splice(index, 1); vault.save(); return { ok: true };
    }
    if (route === 'tasks' && method === 'POST') {
      scope(auth, 'tasks:write'); if (!state.apps.includes('butler')) fail('Install Butler to add tasks.', 409);
      if (state.tasks.length >= 2000) fail('The task limit has been reached.');
      const task = { id: id(), title: text(b.title, 'a task', 500), dueAt: due(b.dueAt), visibility: auth.client ? 'household' : visibility(b.visibility), ownerId: member.id, done: false, createdAt: new Date().toISOString(), notifiedAt: null };
      state.tasks.unshift(task); vault.save(); return { task };
    }
    if (route === 'tasks' && method === 'PATCH') {
      scope(auth, 'tasks:write'); if (!state.apps.includes('butler')) fail('Install Butler to change tasks.', 409);
      const task = state.tasks.find(t => t.id === b.id);
      if (!task || !canRead(task, member) || (auth.client && task.visibility !== 'household')) fail('Task not found.', 404);
      if (typeof b.done !== 'boolean') fail('Choose a task status.');
      task.done = b.done; vault.save(); return { ok: true };
    }
    if (route === 'apps' && method === 'POST') {
      owner(auth); const app = APPS.find(a => a.id === b.id);
      if (!app) fail('App not found.', 404);
      if (typeof b.install !== 'boolean') fail('Choose install or remove.');
      state.apps = state.apps.filter(a => a !== app.id); if (b.install) state.apps.push(app.id);
      vault.audit(member.id, b.install ? 'app.installed' : 'app.removed', app.id); vault.save(); return { ok: true };
    }
    if (route === 'clients' && method === 'POST') {
      owner(auth);
      const name = text(b.name, 'a device name', 80);
      if (!['phone', 'pod', 'robot', 'screen'].includes(b.type)) fail('Choose a device type.');
      if (!Array.isArray(b.scopes) || !b.scopes.length || b.scopes.some(s => !CLIENT_SCOPES.includes(s))) fail('Choose valid device permissions.');
      const roomId = b.roomId || null;
      if (roomId && !state.rooms.some(r => r.id === roomId)) fail('Choose a room in your home.');
      if (['pod', 'robot'].includes(b.type) && !roomId) fail('Assign this device to a room.');
      const code = token(), expires = Date.now() + 5 * 60000;
      pairings.set(hash(code), { name, type: b.type, scopes: [...new Set(b.scopes)], roomId, memberId: member.id, expires });
      return { code, expires, endpoint: origin + '/v1/home/pair' };
    }
    if (route === 'clients' && method === 'DELETE') {
      owner(auth); const client = state.clients.find(c => c.id === b.id);
      if (!client) fail('Device not found.', 404);
      client.revokedAt = new Date().toISOString(); vault.audit(member.id, 'device.revoked', client.id); vault.save(); return { ok: true };
    }
    if (route === 'connections/ha' && method === 'POST') {
      owner(auth); const url = text(b.url, 'the Home Assistant address', 200);
      await validateLocalUrl(url);
      const connection = { url, token: text(b.token, 'your Home Assistant token', 2000) };
      const states = await ha(connection, 'states');
      state.connections.ha = connection; state.devices = visibleDevices(states);
      vault.audit(member.id, 'integration.connected', 'home-assistant'); vault.save(); return { devices: state.devices };
    }
    if (route === 'connections/ha' && method === 'DELETE') {
      owner(auth); delete state.connections.ha; state.devices = []; vault.save(); return { ok: true };
    }
    if (route === 'devices/discover' && method === 'POST') {
      owner(auth); if (!state.connections.ha) fail('Connect Home Assistant first.');
      const latest = visibleDevices(await ha(state.connections.ha, 'states'));
      state.devices = latest.map(d => { const previous = state.devices.find(p => p.id === d.id); return { ...d, enabled: !!previous?.enabled, roomId: previous?.roomId || null }; });
      vault.save(); return { devices: state.devices };
    }
    if (route === 'devices' && method === 'PATCH') {
      owner(auth); const device = state.devices.find(d => d.id === b.id);
      if (!device) fail('Device not found.', 404);
      if (b.roomId && !state.rooms.some(r => r.id === b.roomId)) fail('Room not found.');
      if (typeof b.enabled !== 'boolean') fail('Choose whether Aspen may access this device.');
      device.enabled = b.enabled; device.roomId = b.roomId || null; vault.save(); return { ok: true };
    }
    if (route === 'devices/action' && method === 'POST') {
      scope(auth, 'devices:control');
      if (!auth.client && !['owner', 'adult'].includes(member.role)) fail('An adult must change household devices.', 403);
      const device = state.devices.find(d => d.id === b.id && d.enabled);
      if (!device || (auth.client?.roomId && auth.client.roomId !== device.roomId)) fail('This device is outside your access.', 403);
      // Only lights are controllable in v1. Locks, alarms, appliances and robot
      // movement are deliberately absent from the allowlist.
      if (device.kind !== 'light' || !['turn_on', 'turn_off'].includes(b.action)) fail('That action is not supported.');
      await ha(state.connections.ha, 'services/light/' + b.action, { entity_id: device.id });
      // Read the device back; a submitted command is not proof of success.
      const actual = await ha(state.connections.ha, 'states/' + encodeURIComponent(device.id));
      device.state = actual.state;
      vault.audit(member.id, 'light.' + b.action, device.id); vault.save();
      return { state: device.state, confirmed: actual.state === (b.action === 'turn_on' ? 'on' : 'off') };
    }
    if (route === 'plans/draft' && method === 'POST') {
      human(auth); limit(req, 'plan', 10);
      if (member.role === 'guest') fail('Join as a family member to make a plan.', 403);
      if (!state.apps.includes('butler')) fail('Add Butler from Apps first.', 409);
      const source = text(b.source, 'a message to plan from', 4000);
      if (pendingChat.has(member.id)) fail('Aspen is still working on your previous request.', 429);
      pendingChat.add(member.id);
      try {
        const tasks = await draftPlan(source, model);
        authenticate(req); // Sign-out during inference must not expose a draft.
        const plan = {id:id(), memberId:member.id, tasks, expires:Date.now()+10*60000};
        plans.set(member.id, plan); // One bounded, short-lived draft per person.
        return {id:plan.id, tasks, expires:plan.expires};
      } finally { pendingChat.delete(member.id); }
    }
    if (route === 'plans/approve' && method === 'POST') {
      human(auth);
      const plan = plans.get(member.id);
      if (!plan || plan.id !== b.id || plan.expires < Date.now()) fail('This draft expired or was already saved. Make a new plan.', 409);
      if (!state.apps.includes('butler')) fail('Add Butler from Apps first.', 409);
      if (!Array.isArray(b.tasks) || !b.tasks.length || b.tasks.length > plan.tasks.length) fail('Choose up to five tasks from your draft.');
      if (state.tasks.length + b.tasks.length > 2000) fail('The task limit has been reached.');
      const tasks = b.tasks.map(t => ({id:id(),title:text(t?.title,'a task',500),dueAt:due(t.dueAt),visibility:visibility(b.visibility),ownerId:member.id,done:false,createdAt:new Date().toISOString(),notifiedAt:null}));
      const previous = state.tasks;
      state.tasks = [...tasks, ...previous];
      try { vault.save(); } catch(e) { state.tasks = previous; throw e; }
      plans.delete(member.id);
      return {tasks};
    }
    if (route === 'chat' && method === 'POST') {
      scope(auth, 'chat:ask'); limit(req, 'chat', 20);
      const message = text(b.message, 'a question', 2000);
      const key = auth.client?.id || member.id;
      if (pendingChat.has(key)) fail('Aspen is still answering your previous question.', 429);
      pendingChat.add(key);
      try {
        const view = publicState(auth);
        return await model.answer(message, { household: view.household.name, room: auth.client?.roomId ? view.rooms[0]?.name : null, person: auth.client ? 'Shared room device; speaker identity is unknown' : member.name,
          memories: view.memories.map(m => m.text), tasks: view.tasks.filter(t => !t.done).map(t => ({ title: t.title, dueAt: t.dueAt })), devices: view.devices });
      } finally { pendingChat.delete(key); }
    }
    fail('Not found.', 404);
  }
  const staticDir = options.staticDir || path.resolve(__dirname, '../../site/home');
  const handler = async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('Permissions-Policy', 'microphone=(), camera=(), geolocation=()');
    try {
      // Exact host allowlist prevents DNS rebinding; browser writes require the
      // actual origin. Device clients use Bearer auth and no browser cookies.
      const allowedHost = new URL(origin).host;
      if (req.headers.host !== allowedHost) fail('Invalid host.', 403);
      if (req.headers.origin && req.headers.origin !== origin) fail('Invalid origin.', 403);
      const url = new URL(req.url, origin);
      if (url.pathname.startsWith('/v1/home/')) {
        if (req.method !== 'GET' && !req.headers.authorization && req.headers.origin !== origin) fail('Open this action from Aspen.', 403);
        const result = await api(req, res, url.pathname.slice('/v1/home/'.length));
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result)); return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) fail('Method not allowed.', 405);
      const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
      const file = path.resolve(staticDir, '.' + pathname);
      if (!file.startsWith(staticDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) fail('Not found.', 404);
      const type = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }[path.extname(file)];
      res.setHeader('Content-Type', (type || 'application/octet-stream') + (type?.startsWith('text/') ? '; charset=utf-8' : ''));
      if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
    } catch (error) {
      res.statusCode = error.status || 500; res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: error.status ? error.message : 'Aspen could not complete that request. Please try again.' }));
    }
  };
  const server = tls ? https.createServer(tls, handler) : http.createServer(handler);
  server.requestTimeout = 60000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 4141, host, resolve); });
  origin = options.origin || `${tls ? 'https' : 'http'}://${host.includes(':') ? '[' + host + ']' : host}:${server.address().port}`;
  if (new URL(origin).protocol !== (tls ? 'https:' : 'http:')) { server.close(); throw new Error('Origin protocol must match the server.'); }
  const scheduler = setInterval(() => {
    let changed = false;
    if (state.apps.includes('butler')) for (const task of state.tasks) {
      if (task.dueAt && !task.done && !task.notifiedAt && new Date(task.dueAt) <= new Date()) {
        task.notifiedAt = new Date().toISOString(); changed = true;
        options.onReminder?.({ title: task.visibility === 'private' ? 'A private reminder is due' : task.title, id: task.id });
      }
    }
    if (changed) vault.save();
    for (const map of [sessions, invitations, pairings, plans]) for (const [key, entry] of map) if (entry.expires < Date.now()) map.delete(key);
    for (const [key, entry] of attempts) if (entry.until < Date.now()) attempts.delete(key);
  }, 15000);
  scheduler.unref();
  return { server, origin, bootstrap, vault, url: origin + (state.household ? '/' : '/#setup=' + bootstrap), close: () => { clearInterval(scheduler); server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); } };
}

if (require.main === module) {
  const tls = process.env.ASPEN_TLS_CERT && process.env.ASPEN_TLS_KEY ? { cert: fs.readFileSync(process.env.ASPEN_TLS_CERT), key: fs.readFileSync(process.env.ASPEN_TLS_KEY) } : undefined;
  createHomeServer({ port: Number(process.env.ASPEN_HOME_PORT || 4141), host: process.env.ASPEN_HOME_HOST || '127.0.0.1', origin: process.env.ASPEN_HOME_ORIGIN, dataDir: process.env.ASPEN_HOME_DATA, tls,
    vaultOptions: process.env.ASPEN_VAULT_KEY ? { key: process.env.ASPEN_VAULT_KEY } : undefined,
  }).then(home => {
    console.log('Aspen is ready. Open this private setup link on this computer:\n' + home.url);
    process.once('SIGINT', async () => { await home.close(); process.exit(0); });
    process.once('SIGTERM', async () => { await home.close(); process.exit(0); });
  }).catch(err => { console.error(err.message); process.exitCode = 1; });
}
module.exports = { createHomeServer, APPS, CLIENT_SCOPES };
