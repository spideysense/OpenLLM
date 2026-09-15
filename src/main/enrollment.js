const crypto = require('node:crypto');
const store = require('./store');
const token = prefix => prefix + crypto.randomBytes(32).toString('base64url');
const matches = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

function initialize() {
  if (store.get('householdEnrollment')) return;
  const enrolled = (store.get('apikeys') || []).some(k => k.owner);
  const configured = process.env.ASPEN_DEVICE_ID;
  if (configured && !/^[a-f0-9]{12}$/.test(configured)) throw new Error('Invalid appliance identity');
  store.set('householdEnrollment', {
    version: 1, deviceId: configured || crypto.randomBytes(6).toString('hex'), enrolled,
    setup: enrolled ? null : token('setup-aspen-'), recovery: null, pending: null,
  });
}
function transportKeys() {
  const state = store.get('householdEnrollment');
  return [state?.setup, state?.recovery].filter(Boolean).map(secret => ({ secret, enrollmentOnly: true }));
}
function status() {
  const s = store.get('householdEnrollment');
  return s ? { deviceId: s.deviceId, enrolled: s.enrolled, recoveryReady: !!s.recovery } : null;
}
function prepare(secret, label) {
  const s = store.get('householdEnrollment');
  const owner = (store.get('apikeys') || []).find(k => k.owner && matches(k.secret, secret));
  const setup = s && !s.enrolled && matches(s.setup, secret);
  const recovery = s && s.enrolled && matches(s.recovery, secret);
  if (!s || (!owner && !setup && !recovery)) throw new Error('Invalid setup or recovery code');
  if (typeof label !== 'string' || !label.trim() || label.length > 100) throw new Error('Enter your name (up to 100 characters)');
  // A lost response is safely repeatable; no identity changes until confirmation.
  if (s.pending?.authorizer === secret && s.pending.expires > Date.now()) return publicPending(s.pending);
  const key = {
    id: crypto.randomUUID(), userId: 'owner', label: label.trim(),
    secret: token('sk-aspen-'), owner: true, memory: true,
    created: new Date().toISOString(), lastUsed: null,
  };
  s.pending = { id: crypto.randomUUID(), authorizer: secret, key, recovery: token('recovery-aspen-'), expires: Date.now() + 15 * 60_000 };
  store.set('householdEnrollment', s);
  return publicPending(s.pending);
}
function publicPending(p) {
  return { id: p.id, credential: p.key.secret, recovery: p.recovery, expires: p.expires };
}
function confirm(secret, id) {
  const config = store.get(), s = config.householdEnrollment, p = s?.pending;
  if (!p || !matches(p.authorizer, secret) || p.id !== id || p.expires <= Date.now()) throw new Error('Setup expired. Start again.');
  if (!transportKeys().some(k => matches(k.secret, secret)) && !(config.apikeys || []).some(k => k.owner && matches(k.secret, secret))) throw new Error('Access revoked');
  // One durable write consumes the setup/recovery code and replaces all owner
  // device credentials. Person IDs and family members' private data stay stable.
  config.apikeys = [...(config.apikeys || []).filter(k => !k.owner), p.key];
  config.householdEnrollment = { ...s, enrolled: true, setup: null, recovery: p.recovery, pending: null };
  config.onboarded = true;
  config.cloudMode = 'off';
  store.replace(config);
  require('./chat-service').stopAll();
  return { success: true };
}
async function handle(req, res) {
  if (req.url !== '/v1/enroll') return false;
  let code = 200, value;
  try {
    if (!req.aspenSecure || req.method !== 'POST') throw new Error('Use encrypted setup');
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 4096) throw new Error('Setup request too large'); }
    const input = JSON.parse(raw), secret = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (input.action === 'prepare') value = prepare(secret, input.label);
    else if (input.action === 'confirm') value = confirm(secret, input.id);
    else throw new Error('Unsupported setup action');
  } catch (error) { code = 400; value = { error: error.message }; }
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
  return true;
}
module.exports = { initialize, transportKeys, status, prepare, confirm, handle };
