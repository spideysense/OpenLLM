/**
 * LLM Bear Auto-Updater
 *
 * Checks GitHub releases for new versions and installs silently.
 * User sees a subtle notification when an update is ready — click to restart.
 * No manual downloads. No re-dragging to Applications. Just works.
 */
const { autoUpdater } = require('electron-updater');
const { app } = require('electron');

let mainWindow = null;
let updateReady = false;

function init(win) {
  mainWindow = win;

  // Don't check for updates in dev mode
  if (!app.isPackaged) {
    console.log('[Updater] Skipping — not packaged');
    return;
  }

  // Configure
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  // ── Events ──

  autoUpdater.on('checking-for-update', () => {
    console.log('[Updater] Checking for update...');
    notify('checking');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[Updater] Update available:', info.version);
    notify('available', { version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[Updater] Already up to date');
    notify('up-to-date');
  });

  autoUpdater.on('download-progress', (progress) => {
    const pct = Math.round(progress.percent);
    notify('downloading', { percent: pct });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[Updater] Update downloaded:', info.version);
    updateReady = true;
    notify('ready', { version: info.version });
  });

  autoUpdater.on('error', (err) => {
    console.error('[Updater] Error:', err.message);
    notify('error', { message: err.message });
  });

  // Check now, then every 4 hours
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
  return {
    updateReady,
    currentVersion: app.getVersion(),
  };
}

function notify(status, data = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater:status', { status, ...data });
  }
}

module.exports = { init, checkForUpdates, installUpdate, getStatus };
