/**
 * FreeLLM Auto-Updater
 *
 * Downloads updates silently in the background.
 * When ready, shows a 30-second countdown banner then auto-restarts.
 * User can click "Restart Now" or dismiss and it'll install on next quit.
 *
 * Works on Mac (DMG/ZIP) and Windows (NSIS).
 */
const { autoUpdater } = require('electron-updater');
const { app } = require('electron');

let mainWindow = null;
let updateReady = false;
let countdownTimer = null;

function init(win) {
  mainWindow = win;

  if (!app.isPackaged) {
    console.log('[Updater] Skipping — dev mode');
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  // Mac: must use ZIP target for delta updates — DMG alone won't auto-update
  // Windows: NSIS installer handles it natively

  autoUpdater.on('checking-for-update', () => notify('checking'));

  autoUpdater.on('update-available', (info) => {
    console.log('[Updater] Update available:', info.version);
    notify('available', { version: info.version });
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
    notify('ready', { version: info.version });
    startAutoRestartCountdown(info.version);
  });

  autoUpdater.on('error', (err) => {
    console.error('[Updater] Error:', err.message);
    notify('error', { message: err.message });
  });

  checkForUpdates();
  setInterval(checkForUpdates, 4 * 60 * 60 * 1000);
}

function startAutoRestartCountdown(version) {
  let seconds = 30;
  notify('countdown', { version, seconds });

  countdownTimer = setInterval(() => {
    seconds--;
    notify('countdown', { version, seconds });
    if (seconds <= 0) {
      clearInterval(countdownTimer);
      installUpdate();
    }
  }, 1000);
}

function dismissCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  // Will still install on next app quit
  notify('ready', { version: null, dismissed: true });
}

function checkForUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.checkForUpdates().catch((err) => {
    console.error('[Updater] Check failed:', err.message);
  });
}

function installUpdate() {
  if (updateReady) {
    // isSilent=false on Windows shows the installer UI
    // isForceRunAfter=true reopens the app after install
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

module.exports = { init, checkForUpdates, installUpdate, dismissCountdown, getStatus };
