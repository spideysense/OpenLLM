/**
 * Monet Auto-Updater
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
  if (updateReady) {
    autoUpdater.quitAndInstall(false, true);
  }
}

function getStatus() {
  return { updateReady, currentVersion: app.getVersion() };
}

function notify(status, data = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater:status', { status, ...data });
  }
}

module.exports = { init, checkForUpdates, installUpdate, getStatus };
