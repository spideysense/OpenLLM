const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, clipboard, systemPreferences } = require('electron');
const path = require('path');
const ollama = require('./ollama');
const models = require('./models');
const system = require('./system');
const gateway = require('./gateway');
const apikeys = require('./apikeys');
const aliases = require('./aliases');
const registry = require('./registry');
const store = require('./store');
const toolSettings = require('./tool-settings');
const connectors = require('./connectors');
const agent = require('./agent');
const tunnel = require('./tunnel');
const updater = require('./updater');
const hotUpdater = require('./hot-updater');
const conversations = require('./conversations');

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
    mainWindow.loadFile(hotUpdater.resolveRendererPath());
  }

  // Set COOP/COEP headers so SharedArrayBuffer works for Piper WASM TTS
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Cross-Origin-Opener-Policy': ['same-origin'],
        'Cross-Origin-Embedder-Policy': ['require-corp'],
      },
    });
  });

  // Grant microphone/audio permissions for voice input (Web Speech API)
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ['media', 'microphone', 'audioCapture'];
    callback(allowed.includes(permission));
  });
  mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission) => {
    return ['media', 'microphone', 'audioCapture'].includes(permission);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  // Placeholder — will use a proper aspen icon in production
  tray = new Tray(nativeImage.createEmpty());
  const contextMenu = Menu.buildFromTemplate([
    { label: '🐻 Aspen', enabled: false },
    { type: 'separator' },
    { label: 'Open Aspen', click: () => mainWindow?.show() || createWindow() },
    { type: 'separator' },
    { label: 'Model: Loading...', id: 'model-status', enabled: false },
    { label: 'API: Loading...', id: 'api-status', enabled: false },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setToolTip('Aspen');
  tray.setContextMenu(contextMenu);
}

// ═══════════════════════════════════════════════════
// App Lifecycle
// ═══════════════════════════════════════════════════

app.whenReady().then(async () => {
  // Request mic access upfront so macOS grants it once permanently
  if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('microphone') !== 'granted') {
    await systemPreferences.askForMediaAccess('microphone').catch(() => {});
  }

  // Hot update check BEFORE window — correct renderer loads immediately, no flicker
  await hotUpdater.checkForUpdate();

  createWindow();
  createTray();

  // Ensure gateway always requires auth — auto-generate a key on first launch
  // so the app is never in open mode when the Cloudflare tunnel is active.
  const existingKeys = apikeys.listKeys();
  if (existingKeys.length === 0) {
    const defaultKey = apikeys.createKey('Default');
    console.log('[Security] Auto-generated default API key:', defaultKey.secret.slice(0, 20) + '...');
    store.set('defaultKeyGenerated', true);
  }

  // Start Ollama — push status to renderer once ready, then poll every 5s
  ollama.ensureRunning((progress) => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('ollama:progress', { message: progress });
  }).then(async () => {
    const status = await ollama.getStatus();
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('ollama:status', status);
  });
  setInterval(async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const status = await ollama.getStatus();
    mainWindow.webContents.send('ollama:status', status);
  }, 5000);

  // Start API gateway
  gateway.start();

  // ── Weekly best-model check ──
  // Once a week, compare installed models against the recommended registry
  // (hosted at registry/models.json on GitHub — update it when a new model
  // becomes best-in-class). If a better model is available for the user's
  // hardware, notify the UI so it can prompt them. Never auto-downloads or
  // switches silently — the user decides.
  async function runWeeklyModelCheck() {
    try {
      const last = store.get('lastModelCheck') || 0;
      const WEEK = 7 * 24 * 60 * 60 * 1000;
      if (Date.now() - last < WEEK) return;
      const installed = await models.listModels();
      const reg = await registry.getRegistry();
      const tier = system.getHardwareTier();
      const upgrades = registry.checkUpgrades(installed, reg, tier);
      store.set('lastModelCheck', Date.now());
      if (upgrades.length === 0) return;
      // Don't re-nag about an upgrade the user already dismissed.
      const dismissed = store.get('dismissedUpgrades') || [];
      const fresh = upgrades.filter(u => !dismissed.includes(u.recommended.model));
      if (fresh.length === 0) return;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('models:upgradeAvailable', fresh);
      }
    } catch { /* best-effort; never block startup */ }
  }
  // Run shortly after launch, then every 24h (the WEEK throttle gates actual checks).
  setTimeout(runWeeklyModelCheck, 30000);
  setInterval(runWeeklyModelCheck, 24 * 60 * 60 * 1000);

  // Start tunnel — gives every user a free public URL via Cloudflare
  tunnel.start((status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tunnel:status', {
        connected: status.status === 'connected',
        url: status.url || null,
        status: status.status,
      });
    }
  });

  // Reconnect any connectors the user previously set up (their tokens live
  // encrypted in the OS keychain). Best-effort — never block startup.
  connectors.reconnectSaved().catch(() => {});

  // Auto-updater — checks GitHub releases, downloads + installs silently
  updater.init(mainWindow);

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
// IPC Handlers — Connectors (MCP)
// ═══════════════════════════════════════════════════

ipcMain.handle('connectors:list', async () => {
  return connectors.listConnectors();
});

ipcMain.handle('connectors:connect', async (event, { id, token }) => {
  try {
    const r = await connectors.connect(id, token);
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('connectors:disconnect', async (event, { id }) => {
  try {
    await connectors.disconnect(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('connectors:removeToken', async (event, { id }) => {
  try {
    await connectors.disconnect(id);
    connectors.deleteToken(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ═══════════════════════════════════════════════════
// IPC Handlers — Ollama
// ═══════════════════════════════════════════════════

ipcMain.handle('ollama:status', async () => {
  return ollama.getStatus();
});

ipcMain.handle('ollama:ensureRunning', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const notify = (msg) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('ollama:progress', msg);
    }
  };
  return ollama.ensureRunning(notify);
});

ipcMain.handle('ollama:isInstalled', async () => {
  return ollama.isInstalled();
});

ipcMain.handle('ollama:install', async () => {
  return ollama.install();
});

// ── File text extraction (PDF / Word / Excel -> plain text, all local) ──
ipcMain.handle('files:extractText', async (event, payload) => {
  const { extractText } = require('./file-extract');
  return extractText(payload || {});
});

// ── Vision (multimodal) ──
ipcMain.handle('ollama:hasVisionModel', async () => {
  return ollama.hasVisionModel();
});
ipcMain.handle('ollama:isVisionModel', async (event, model) => {
  return ollama.isVisionModel(model);
});
ipcMain.handle('ollama:recommendedVisionModel', async () => {
  return ollama.RECOMMENDED_VISION_MODEL;
});
ipcMain.handle('ollama:pullModel', async (event, model) => {
  return ollama.pullModel(model, (p) => {
    try { event.sender.send('ollama:pullProgress', p); } catch {}
  });
});
ipcMain.handle('ollama:abortPull', async () => {
  return ollama.abortPull();
});

// ═══════════════════════════════════════════════════
// IPC Handlers — Models
// ═══════════════════════════════════════════════════

ipcMain.handle('models:list', async () => {
  return models.listModels();
});

ipcMain.handle('models:pull', async (event, modelName) => {
  const notify = (progress) => mainWindow?.webContents.send('models:pullProgress', { model: modelName, ...progress });
  const status = (msg) => notify({ status: msg, total: 0, completed: 0, percent: 0 });

  // Daisy-chain for non-technical users: make sure the AI engine is new enough
  // BEFORE pulling. Newer models (gemma4, qwen3, llama4) need a recent Ollama.
  if (!(await ollama.isCurrentEnough())) {
    status('Updating AI engine…');
    await ollama.ensureCurrent((m) => status(typeof m === 'string' ? m : 'Updating AI engine…'));
    // After a restart the new server needs a moment before it can serve pulls.
    // Poll /api/tags until it actually responds, so the pull doesn't fire early
    // (which left it stalled and forced a manual app restart).
    status('Connecting to AI engine…');
    for (let i = 0; i < 30; i++) {
      try {
        const r = await fetch('http://127.0.0.1:11434/api/tags');
        if (r.ok) break;
      } catch {}
      await new Promise((res) => setTimeout(res, 500));
    }
  }

  let result = await models.pullModel(modelName, notify);

  // Safety net: if the pull still failed because the engine is too old, upgrade
  // and retry once.
  if (!result.success && /newer version|412/i.test(result.error || '')) {
    status('Updating AI engine…');
    const up = await ollama.ensureCurrent((m) => status(typeof m === 'string' ? m : 'Updating AI engine…'));
    if (up.success) {
      status('Connecting to AI engine…');
      for (let i = 0; i < 30; i++) {
        try { const r = await fetch('http://127.0.0.1:11434/api/tags'); if (r.ok) break; } catch {}
        await new Promise((res) => setTimeout(res, 500));
      }
      result = await models.pullModel(modelName, notify);
    }
  }
  return result;
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
  // Prepend system prompt so the model knows it's running locally
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  const SYSTEM_PROMPT = {
    role: 'system',
    content: `You are a helpful AI assistant running locally inside Aspen on the user's own computer. All processing is 100% on this machine — nothing leaves the device. The current date is ${dateStr} and the time is ${timeStr}. When asked to build a web page or website, always produce ONE self-contained HTML file with all CSS inside a <style> tag and all JavaScript inside a <script> tag — never split into separate files and never use external <link rel="stylesheet"> or external script src references, so it previews correctly. Use a code fence labeled html. Be helpful, friendly, and concise.`,
  };

  // Only prepend if there's no existing system message
  const hasSystem = messages.some((m) => m.role === 'system');
  const fullMessages = hasSystem ? messages : [SYSTEM_PROMPT, ...messages];

  // Route per-message: only use the (non-streaming) agent when the message
  // actually needs a tool. Normal chat streams directly from Ollama token-by-
  // token, so it feels instant instead of hanging until the full answer is ready.
  const lastUser = [...fullMessages].reverse().find((m) => m.role === 'user');
  const userText = lastUser?.content || '';

  // SOTA native tool-calling: when tools are enabled, route through the agent loop
  // and let the MODEL decide whether (and which) tool to call via Ollama's native
  // tools API. No keyword regex — Gemma 4 / Qwen have native function calling and
  // pick the tool (or none) themselves, which is more reliable and general than
  // pattern-matching. The agent loop has its own plain-text fallback when a small
  // model mis-formats a tool call, so non-tool questions still answer normally.
  if (agent.isEnabled()) {
    try {
      const content = await agent.runAgent({ model, messages: fullMessages });
      mainWindow?.webContents.send('chat:stream', { content: content || '', done: false });
      mainWindow?.webContents.send('chat:stream', { content: '', done: true });
      return { content: content || '' };
    } catch (e) {
      const msg = `⚠️ ${e.message}`;
      mainWindow?.webContents.send('chat:stream', { content: msg, done: false });
      mainWindow?.webContents.send('chat:stream', { content: '', done: true });
      return { content: msg };
    }
  }

  return ollama.chat(model, fullMessages, (chunk) => {
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

ipcMain.handle('registry:dismissUpgrade', async (event, modelId) => {
  const dismissed = store.get('dismissedUpgrades') || [];
  if (!dismissed.includes(modelId)) { dismissed.push(modelId); store.set('dismissedUpgrades', dismissed); }
  return true;
});

// ═══════════════════════════════════════════════════
// IPC Handlers — Store / Settings
// ═══════════════════════════════════════════════════

// ── Store IPC ── allowlisted keys only (renderer must not touch security-sensitive state)
const STORE_ALLOWLIST = new Set([
  'onboarded', 'activeModel', 'totalExchanges', 'theme', 'windowBounds', 'worldModel',
]);

ipcMain.handle('store:get', async (event, key) => {
  return store.get(key);
});

ipcMain.handle('store:set', async (event, key, value) => {
  if (!STORE_ALLOWLIST.has(key)) {
    console.warn('[Security] Blocked store:set for non-allowlisted key:', key);
    return false;
  }
  return store.set(key, value);
});

// ── Tool settings (all tools ON by default) ──
ipcMain.handle('tools:list', async () => {
  return toolSettings.getToolStates();
});

ipcMain.handle('tools:setEnabled', async (event, { name, enabled }) => {
  return toolSettings.setToolEnabled(name, enabled);
});

ipcMain.handle('app:openExternal', async (event, url) => {
  // Only allow http/https to prevent protocol handler abuse (file://, smb://, etc.)
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      shell.openExternal(url);
    } else {
      console.warn('[Security] Blocked openExternal with disallowed protocol:', parsed.protocol);
    }
  } catch {
    console.warn('[Security] Blocked openExternal with invalid URL');
  }
});

// ── Conversation Persistence ──
ipcMain.handle('conversations:load', async () => {
  return conversations.load();
});

ipcMain.handle('conversations:save', async (event, convos) => {
  return conversations.save(convos);
});

ipcMain.handle('conversations:delete', async (event, id) => {
  return conversations.deleteConversation(id);
});

ipcMain.handle('conversations:clear', async () => {
  return conversations.clear();
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
      mainWindow.webContents.send('tunnel:status', {
        connected: status.status === 'connected',
        url: status.url || null,
        status: status.status,
      });
    }
  });
  return true;
});

// ═══════════════════════════════════════════════════
// IPC Handlers — Auto-Updater
// ═══════════════════════════════════════════════════

// Clipboard
ipcMain.handle('clipboard:write', async (_, text) => {
  if (typeof text === 'string') clipboard.writeText(text);
  return true;
});

ipcMain.handle('updater:check', async () => {
  updater.checkForUpdates();
  return true;
});

ipcMain.handle('updater:install', async () => {
  updater.installUpdate();
  return true;
});

ipcMain.handle('updater:status', async () => {
  return updater.getStatus();
});

// Hot updater IPC
ipcMain.handle('hotUpdater:check', async () => { hotUpdater.checkForUpdate(); return true; });
ipcMain.handle('hotUpdater:version', async () => hotUpdater.getCurrentVersion());
ipcMain.handle('hotUpdater:reload', async () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadFile(hotUpdater.resolveRendererPath());
  return true;
});
