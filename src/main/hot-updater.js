// Renderer and main process are one release unit. Never execute independently
// downloaded UI with privileged IPC access. Full application updates own signing,
// verification and installation; a renderer refresh cannot interrupt a job.
const path = require('path');
function resolveRendererPath() { return path.join(__dirname, '..', '..', 'build', 'index.html'); }
function getCurrentVersion() { return require('electron').app.getVersion(); }
module.exports = { resolveRendererPath, getCurrentVersion, init() {}, stop() {},
  checkForUpdate: async () => ({ source: 'application', status: 'bundled' }) };
