const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
function keyStore() {
  if (!process.versions.electron) return require('./service-key').provider();
  try {
    const s = require('electron').safeStorage;
    if (
      s?.isEncryptionAvailable() &&
      s.getSelectedStorageBackend?.() !== 'basic_text'
    )
      return s;
  } catch {}
  return null;
}
function decode(raw) {
  const record = JSON.parse(raw);
  if (record?.format !== 'aspen-os-encrypted-v1') return record;
  const secure = keyStore();
  if (!secure)
    throw new Error(
      'Unlock your operating system keychain to open Aspen data.'
    );
  return JSON.parse(secure.decryptString(Buffer.from(record.data, 'base64')));
}
function encode(value) {
  const raw = JSON.stringify(value);
  const secure = keyStore();
  return secure
    ? JSON.stringify({
        format: 'aspen-os-encrypted-v1',
        data: secure.encryptString(raw).toString('base64')
      })
    : raw;
}
function atomicWrite(file, raw) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    fs.writeFileSync(fd, raw, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, file);
    try {
      const d = fs.openSync(path.dirname(file), 'r');
      try {
        fs.fsyncSync(d);
      } finally {
        fs.closeSync(d);
      }
    } catch {}
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try {
      fs.unlinkSync(tmp);
    } catch {}
  }
}
function read(file, fallback) {
  if (!fs.existsSync(file)) {
    if (fs.existsSync(file + '.bak'))
      return decode(fs.readFileSync(file + '.bak', 'utf8'));
    return structuredClone(fallback);
  }
  try {
    return decode(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    try {
      return decode(fs.readFileSync(file + '.bak', 'utf8'));
    } catch {
      throw new Error(
        `Aspen could not recover ${path.basename(file)}. Your files were preserved. ${error.message}`
      );
    }
  }
}
function write(file, value) {
  const raw = encode(value);
  if (fs.existsSync(file)) {
    // Never replace recovery data with a corrupt record. Re-encrypt legacy backups.
    try {
      atomicWrite(file + '.bak', encode(decode(fs.readFileSync(file, 'utf8'))));
    } catch {}
  }
  atomicWrite(file, raw);
}
function migrateKnownRecords() {
  if (!keyStore()) return;
  const dir = (process.env.ASPEN_DATA_DIR || path.join(require('os').homedir(), '.aspen'));
  for (const name of ['config.json', 'conversations.json', 'secrets.json']) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf8');
      let encrypted = false;
      try {
        encrypted = JSON.parse(raw)?.format === 'aspen-os-encrypted-v1';
      } catch {}
      if (!encrypted) write(file, read(file, null));
    }
  }
}
module.exports = {
  // Authorization records must fail closed instead of recovering revoked grants.
  readStrict: (file, fallback) => fs.existsSync(file) ? decode(fs.readFileSync(file, 'utf8')) : structuredClone(fallback),
  read,
  write,
  atomicWrite,
  migrateKnownRecords,
  encrypted: () => !!keyStore()
};
