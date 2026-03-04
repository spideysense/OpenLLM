const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, clipboard } = require('electron');
const path = require('path');
const ollama = require('./ollama');
const models = require('./models');
const system = require('./system');
const gateway = require('./gateway');
const apikeys = require('./apikeys');
const aliases = require('./aliases');
const registry = require('./registry');
const store = require('./store');
const tunnel = require('./tunnel');

const isDev = !app.isPackaged;
let mainWindow = null;
let tray = null;

// ═══════════════════════════════════════════════════
// Window Management
// ═══════════════════════════════════════════════════

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 480,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#E8F4F8',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'build', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  // Placeholder — will use a proper bear icon in production
  tray = new Tray(nativeImage.createEmpty());
  const contextMenu = Menu.buildFromTemplate([
    { label: '🐻 LLM Bear', enabled: false },
    { type: 'separator' },
    { label: 'Open LLM Bear', click: () => mainWindow?.show() || createWindow() },
    { type: 'separator' },
    { label: 'Model: Loading...', id: 'model-status', enabled: false },
    { label: 'API: Loading...', id: 'api-status', enabled: false },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setToolTip('LLM Bear');
  tray.setContextMenu(contextMenu);
}

// ═══════════════════════════════════════════════════
// App Lifecycle
// ═══════════════════════════════════════════════════

app.whenReady().then(async () => {
  createWindow();
  createTray();

  // Start Ollama if not running
  await ollama.ensureRunning();

  // Start API gateway
  gateway.start();

  // Start tunnel — gives every user a free public URL via Cloudflare
  tunnel.start((status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tunnel:status', status);
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Keep running in tray on macOS
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  tunnel.stop();
  gateway.stop();
});

// ═══════════════════════════════════════════════════
// IPC Handlers — System
// ═══════════════════════════════════════════════════

ipcMain.handle('system:getInfo', async () => {
  return system.getSystemInfo();
});

ipcMain.handle('system:getHardwareTier', async () => {
  return system.getHardwareTier();
});

// ═══════════════════════════════════════════════════
// IPC Handlers — Ollama
// ═══════════════════════════════════════════════════

ipcMain.handle('ollama:status', async () => {
  return ollama.getStatus();
});

ipcMain.handle('ollama:ensureRunning', async () => {
  return ollama.ensureRunning();
});

ipcMain.handle('ollama:isInstalled', async () => {
  return ollama.isInstalled();
});

ipcMain.handle('ollama:install', async () => {
  return ollama.install();
});

// ═══════════════════════════════════════════════════
// IPC Handlers — Models
// ═══════════════════════════════════════════════════

ipcMain.handle('models:list', async () => {
  return models.listModels();
});

ipcMain.handle('models:pull', async (event, modelName) => {
  return models.pullModel(modelName, (progress) => {
    mainWindow?.webContents.send('models:pullProgress', { model: modelName, ...progress });
  });
});

ipcMain.handle('models:delete', async (event, modelName) => {
  return models.deleteModel(modelName);
});

ipcMain.handle('models:getRunning', async () => {
  return models.getRunningModels();
});

ipcMain.handle('models:recommend', async () => {
  const tier = system.getHardwareTier();
  const reg = await registry.getRegistry();
  return models.getRecommendation(tier, reg);
});

// ═══════════════════════════════════════════════════
// IPC Handlers — Chat
// ═══════════════════════════════════════════════════

ipcMain.handle('chat:send', async (event, { model, messages }) => {
  return ollama.chat(model, messages, (chunk) => {
    mainWindow?.webContents.send('chat:stream', chunk);
  });
});

ipcMain.handle('chat:stop', async () => {
  return ollama.abortChat();
});

// ═══════════════════════════════════════════════════
// IPC Handlers — API Gateway
// ═══════════════════════════════════════════════════

ipcMain.handle('gateway:status', async () => {
  return gateway.getStatus();
});

ipcMain.handle('gateway:getPort', async () => {
  return gateway.getPort();
});

// ═══════════════════════════════════════════════════
// IPC Handlers — API Keys
// ═══════════════════════════════════════════════════

ipcMain.handle('apikeys:list', async () => {
  return apikeys.listKeys();
});

ipcMain.handle('apikeys:create', async (event, label) => {
  return apikeys.createKey(label);
});

ipcMain.handle('apikeys:revoke', async (event, keyId) => {
  return apikeys.revokeKey(keyId);
});

// ═══════════════════════════════════════════════════
// IPC Handlers — Aliases
// ═══════════════════════════════════════════════════

ipcMain.handle('aliases:list', async () => {
  return aliases.getAliases();
});

ipcMain.handle('aliases:set', async (event, { alias, model }) => {
  return aliases.setAlias(alias, model);
});

ipcMain.handle('aliases:getDefaults', async () => {
  return aliases.getDefaultAliases();
});

// ═══════════════════════════════════════════════════
// IPC Handlers — Registry
// ═══════════════════════════════════════════════════

ipcMain.handle('registry:get', async () => {
  return registry.getRegistry();
});

ipcMain.handle('registry:checkUpgrades', async () => {
  const installed = await models.listModels();
  const reg = await registry.getRegistry();
  const tier = system.getHardwareTier();
  return registry.checkUpgrades(installed, reg, tier);
});

// ═══════════════════════════════════════════════════
// IPC Handlers — Store / Settings
// ═══════════════════════════════════════════════════

ipcMain.handle('store:get', async (event, key) => {
  return store.get(key);
});

ipcMain.handle('store:set', async (event, key, value) => {
  return store.set(key, value);
});

ipcMain.handle('app:openExternal', async (event, url) => {
  shell.openExternal(url);
});

ipcMain.handle('app:getVersion', async () => {
  return app.getVersion();
});

// ═══════════════════════════════════════════════════
// IPC Handlers — Tunnel
// ═══════════════════════════════════════════════════

ipcMain.handle('tunnel:getStatus', async () => {
  return {
    connected: tunnel.isConnected(),
    url: tunnel.getPublicUrl(),
  };
});

ipcMain.handle('tunnel:copyUrl', async () => {
  const url = tunnel.getPublicUrl();
  if (url) clipboard.writeText(url + '/v1');
  return url ? url + '/v1' : null;
});

ipcMain.handle('tunnel:restart', async () => {
  tunnel.stop();
  tunnel.start((status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tunnel:status', status);
    }
  });
  return true;
});
