const fs = require('fs');
const crypto = require('crypto');
let secure;
function provider() {
  if (secure) return secure;
  const file = process.env.ASPEN_KEY_FILE;
  if (!file) return null;
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || (process.platform !== 'win32' && stat.mode & 0o077))
    throw new Error('Service credential must be a private regular file');
  const key = fs.readFileSync(file);
  if (key.length !== 32) throw new Error('Service credential must contain exactly 32 random bytes');
  secure = {
    encryptString(value) {
      const nonce = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(Buffer.from('aspen-service-record-v1'));
      return Buffer.concat([
        nonce,
        cipher.update(value, 'utf8'),
        cipher.final(),
        cipher.getAuthTag(),
      ]);
    },
    decryptString(value) {
      if (value.length < 28) throw new Error('Invalid encrypted record');
      const cipher = crypto.createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
      cipher.setAAD(Buffer.from('aspen-service-record-v1'));
      cipher.setAuthTag(value.subarray(-16));
      return Buffer.concat([cipher.update(value.subarray(12, -16)), cipher.final()]).toString(
        'utf8'
      );
    },
  };
  return secure;
}
module.exports = { provider };
