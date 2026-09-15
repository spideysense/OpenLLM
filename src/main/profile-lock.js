const fs = require('fs');
const path = require('path');
async function acquire() {
  const dir = process.env.ASPEN_DATA_DIR || path.join(require('os').homedir(), '.aspen');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return require('proper-lockfile').lock(dir, {
    stale: 10000, update: 2000,
    retries: { retries: 12, minTimeout: 1000, maxTimeout: 1000 },
    onCompromised: () => { console.error('Aspen lost exclusive ownership of its data. Stopping.'); process.exit(1); },
  });
}
module.exports = { acquire };
