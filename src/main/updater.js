/**
 * Aspen Auto-Updater
 *
 * Downloads updates silently in the background.
 * Shows a quiet sidebar notification when ready.
 * User clicks to restart when THEY want. No countdowns. No forced restarts.
 * Also installs silently on next quit.
 */
const { autoUpdater } = require('electron-updater');
const { app } = require('electron');

let mainWindow = null;
let updateReady = false;

function init(win) {
  mainWindow = win;

  if (!app.isPackaged) {
    console.log('[Updater] Skipping — dev mode');
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => {
    console.log('[Updater] Checking...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[Updater] Update available:', info.version);
    notify('downloading', { version: info.version, percent: 0 });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[Updater] Up to date');
  });

  autoUpdater.on('download-progress', (progress) => {
    notify('downloading', { percent: Math.round(progress.percent) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[Updater] Downloaded:', info.version);
    updateReady = true;
    // Just notify — no countdown, no forced restart
    notify('ready', { version: info.version });
  });

  autoUpdater.on('error', (err) => {
    console.error('[Updater] Error:', err.message);
  });

  // Check on launch, then every 4 hours
  checkForUpdates();
  setInterval(checkForUpdates, 4 * 60 * 60 * 1000);
}

function checkForUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.checkForUpdates().catch((err) => {
    console.error('[Updater] Check failed:', err.message);
  });
}

function installUpdate() {
  // Returns a result so the renderer can give feedback instead of a dead click.
  if (!updateReady) {
    // No full-app update was downloaded by electron-updater. Re-check in case a
    // release appeared since launch; the caller falls back to the download page.
    checkForUpdates();
    return { ok: false, reason: 'not-downloaded' };
  }
  try {
    // isSilent=false (show the installer), isForceRunAfter=true (relaunch).
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  } catch (err) {
    console.error('[Updater] quitAndInstall failed:', err.message);
    notify('error', { message: err.message });
    return { ok: false, reason: 'install-failed', message: err.message };
  }
}

// Guaranteed fallback: open the latest release so the user can grab the DMG by
// hand when in-place install isn't possible (e.g. an unsigned/old running build).
function openReleasesPage() {
  try {
    require('electron').shell.openExternal('https://github.com/spideysense/OpenLLM/releases/latest');
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

function getStatus() {
  return { updateReady, currentVersion: app.getVersion() };
}

function notify(status, data = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    // source:'app' distinguishes full-app updates from the renderer hot-updater,
    // which shares the same banner. The renderer dispatches the click by source.
    mainWindow.webContents.send('updater:status', { source: 'app', status, ...data });
  }
}

module.exports = { init, checkForUpdates, installUpdate, openReleasesPage, getStatus };
