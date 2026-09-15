// Platform services used by the core. Requiring Electron from Node can download
// a binary; the appliance deliberately has no dependency on a desktop session.
const path = require('path');
const dataDir = process.env.ASPEN_DATA_DIR || path.join(require('os').homedir(), '.aspen');
module.exports = process.versions.electron ? require('electron') : {
  app: { isPackaged: false, getPath: () => dataDir, getVersion: () => require('../../package.json').version },
  safeStorage: {
    isEncryptionAvailable: () => !!require('./service-key').provider(),
    encryptString: value => require('./service-key').provider().encryptString(value),
    decryptString: value => require('./service-key').provider().decryptString(value),
  },
};
