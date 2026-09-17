'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// A local encrypted vault. Desktop protects the key with Electron safeStorage;
// headless installations use a permission-restricted key file or supplied key.
class Vault {
  constructor(dir, { wrapKey, unwrapKey, key } = {}) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.file = path.join(dir, 'household.vault');
    const keyPath = path.join(dir, 'household.key');
    if (key) this.key = Buffer.from(key, 'hex');
    else if (fs.existsSync(keyPath)) {
      const record = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
      if (record.wrapped && !unwrapKey) throw new Error('This vault requires the operating system key store.');
      this.key = record.wrapped ? Buffer.from(unwrapKey(Buffer.from(record.value, 'base64')), 'hex') : Buffer.from(record.value, 'hex');
    } else {
      this.key = crypto.randomBytes(32);
      const record = wrapKey ? { wrapped: true, value: wrapKey(this.key.toString('hex')).toString('base64') } : { wrapped: false, value: this.key.toString('hex') };
      fs.writeFileSync(keyPath, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
    }
    if (this.key.length !== 32) throw new Error('Vault key must contain 32 bytes.');
    this.state = fs.existsSync(this.file) ? this.read() : {
      version: 1, household: null, members: [], rooms: [], memories: [], tasks: [],
      apps: ['butler'], clients: [], devices: [], connections: {}, events: [],
    };
    if (this.state.version !== 1) throw new Error('Unsupported household vault version.');
  }
  read() {
    const { iv, tag, body } = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    const d = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(body, 'base64')), d.final()]).toString('utf8'));
  }
  save() {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(this.state), 'utf8'), cipher.final()]);
    const next = this.file + '.tmp';
    fs.writeFileSync(next, JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), body: body.toString('base64') }), { mode: 0o600 });
    fs.renameSync(next, this.file);
  }
  audit(actor, action, subject) {
    this.state.events.unshift({ id: crypto.randomUUID(), actor, action, subject, at: new Date().toISOString() });
    this.state.events = this.state.events.slice(0, 250);
  }
}
module.exports = { Vault };
