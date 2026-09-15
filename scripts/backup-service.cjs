// Run under the appliance service identity with its encryption credential mounted.
// Stop the service first: the same exclusive profile lock protects export/restore.
const fs = require('fs');
function password(prompt) {
  if (!process.stdin.isTTY) throw new Error('Use a local terminal to enter the backup password');
  return new Promise((resolve, reject) => {
    process.stderr.write(prompt);
    let value = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const done = (error) => {
      process.stdin.removeListener('data', read);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stderr.write('\n');
      error ? reject(error) : resolve(value);
    };
    const read = (chunk) => {
      for (const char of chunk) {
        if (char === '\u0003' || char === '\u0004') return done(new Error('Cancelled'));
        if (char === '\r' || char === '\n') return done();
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ' && value.length < 1024) value += char;
      }
    };
    process.stdin.on('data', read);
  });
}
async function main() {
  const [action, file] = process.argv.slice(2);
  if (!['export', 'restore'].includes(action) || !file)
    throw new Error('Usage: node scripts/backup-service.cjs export|restore /path/to/backup.aspen');
  if (!require('../src/main/service-key').provider())
    throw new Error('Mount the appliance encryption credential first');
  const release = await require('../src/main/profile-lock').acquire();
  try {
    const backup = require('../src/main/backup');
    backup.recover();
    const secret = await password('Backup password (at least 12 characters): ');
    if (action === 'export') {
      if (secret !== (await password('Repeat backup password: ')))
        throw new Error('Passwords do not match');
      const raw = await backup.exportBackup(secret);
      const fd = fs.openSync(file, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, raw);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      console.log('Encrypted backup saved. Keep the password separately from the backup.');
    } else {
      if (fs.statSync(file).size > 512 * 1024 * 1024)
        throw new Error('Backup exceeds the supported size');
      await backup.importBackup(fs.readFileSync(file, 'utf8'), secret);
      console.log(
        'Backup restored. Devices must be paired again; cloud inference and missions are off.'
      );
    }
  } finally {
    await release();
  }
}
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
