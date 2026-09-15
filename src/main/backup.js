const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const records = require('./durable-json');
const journal = path.join(process.env.ASPEN_DATA_DIR || path.join(os.homedir(), '.aspen'), 'restore.pending.json');
function validate(data) {
  if (
    data?.version !== 1 ||
    !data.config ||
    typeof data.config !== 'object' ||
    Array.isArray(data.config) ||
    !Array.isArray(data.conversations) ||
    data.conversations.some((c) => c.id == null || !Array.isArray(c.messages))
  )
    throw new Error('Invalid Aspen backup');
  if (data.vault) require('./vault').get().validateSnapshot(data.vault);
}
function derive(password, salt) {
  if (typeof password !== 'string' || password.length < 12)
    throw new Error('Use a backup password of at least 12 characters.');
  return new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, 32, (error, key) =>
      error ? reject(error) : resolve(key)
    )
  );
}
async function exportBackup(password) {
  const salt = crypto.randomBytes(16),
    nonce = crypto.randomBytes(12),
    key = await derive(password, salt);
  const data = {
    version: 1,
    config: require('./store').get(),
    conversations: require('./conversations').load(),
    vault: require('./vault').get().snapshot()
  };
  const c = crypto.createCipheriv('aes-256-gcm', key, nonce);
  c.setAAD(Buffer.from('aspen-backup-v1'));
  const encrypted = Buffer.concat([c.update(JSON.stringify(data)), c.final()]);
  return JSON.stringify({
    format: 'aspen-backup-v1',
    salt: salt.toString('base64'),
    nonce: nonce.toString('base64'),
    tag: c.getAuthTag().toString('base64'),
    data: encrypted.toString('base64')
  });
}
async function importBackup(raw, password) {
  const envelope = JSON.parse(raw);
  if (envelope.format !== 'aspen-backup-v1')
    throw new Error('Unsupported backup');
  const key = await derive(password, Buffer.from(envelope.salt, 'base64'));
  const c = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(envelope.nonce, 'base64')
  );
  c.setAAD(Buffer.from('aspen-backup-v1'));
  c.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const data = JSON.parse(
    Buffer.concat([
      c.update(Buffer.from(envelope.data, 'base64')),
      c.final()
    ]).toString()
  );
  validate(data);
  // Connector blobs belong to the old OS keychain. Reconnect on the restored device.
  delete data.config.connectorTokens;
  delete data.config.chatJobs;
  delete data.config.secureReplay;
  // A portable backup cannot revive consumed setup or recovery credentials.
  delete data.config.householdEnrollment;
  data.config.cloudMode = 'off';
  // A backup must not resurrect credentials from a previously revoked device.
  if (Array.isArray(data.config.apikeys)) data.config.apikeys = data.config.apikeys.map(k => ({ ...k, secret: 'sk-aspen-' + crypto.randomBytes(24).toString('base64url'), lastUsed: null }));
  // Restoring a backup must not restart historical autonomous actions.
  if (Array.isArray(data.config.missions))
    data.config.missions = data.config.missions.map((m) => ({
      ...m,
      status: m.status === 'active' ? 'stopped' : m.status
    }));
  records.write(journal, data);
  recover();
}
function recover() {
  if (!fs.existsSync(journal)) return;
  const data = records.read(journal, null);
  validate(data);
  require('./store').replace(data.config);
  require('./conversations').save(data.conversations);
  if (data.vault) require('./vault').get().restore(data.vault);
  fs.unlinkSync(journal);
  try {
    fs.unlinkSync(journal + '.bak');
  } catch {}
}
module.exports = { exportBackup, importBackup, recover };
