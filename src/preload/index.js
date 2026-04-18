const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('llmbear', {
  // ── System ──
  system: {
    getInfo: () => ipcRenderer.invoke('system:getInfo'),
    getHardwareTier: () => ipcRenderer.invoke('system:getHardwareTier'),
  },

  // ── Ollama ──
  ollama: {
    status: () => ipcRenderer.invoke('ollama:status'),
    ensureRunning: () => ipcRenderer.invoke('ollama:ensureRunning'),
    isInstalled: () => ipcRenderer.invoke('ollama:isInstalled'),
    install: () => ipcRenderer.invoke('ollama:install'),
    onProgress: (cb) => {
      const handler = (event, data) => cb(data);
      ipcRenderer.on('ollama:progress', handler);
      return () => ipcRenderer.removeListener('ollama:progress', handler);
    },
    onStatus: (cb) => {
      const handler = (event, data) => cb(data);
      ipcRenderer.on('ollama:status', handler);
      return () => ipcRenderer.removeListener('ollama:status', handler);
    },
  },

  // ── Models ──
  models: {
    list: () => ipcRenderer.invoke('models:list'),
    pull: (name) => ipcRenderer.invoke('models:pull', name),
    delete: (name) => ipcRenderer.invoke('models:delete', name),
    getRunning: () => ipcRenderer.invoke('models:getRunning'),
    recommend: () => ipcRenderer.invoke('models:recommend'),
    onPullProgress: (cb) => {
      const handler = (event, data) => cb(data);
      ipcRenderer.on('models:pullProgress', handler);
      return () => ipcRenderer.removeListener('models:pullProgress', handler);
    },
  },

  // ── Chat ──
  chat: {
    send: (model, messages) => ipcRenderer.invoke('chat:send', { model, messages }),
    stop: () => ipcRenderer.invoke('chat:stop'),
    onStream: (cb) => {
      const handler = (event, data) => cb(data);
      ipcRenderer.on('chat:stream', handler);
      return () => ipcRenderer.removeListener('chat:stream', handler);
    },
  },

  // ── Gateway ──
  gateway: {
    status: () => ipcRenderer.invoke('gateway:status'),
    getPort: () => ipcRenderer.invoke('gateway:getPort'),
  },

  // ── API Keys ──
  apikeys: {
    list: () => ipcRenderer.invoke('apikeys:list'),
    create: (label) => ipcRenderer.invoke('apikeys:create', label),
    revoke: (id) => ipcRenderer.invoke('apikeys:revoke', id),
  },

  // ── Aliases ──
  aliases: {
    list: () => ipcRenderer.invoke('aliases:list'),
    set: (alias, model) => ipcRenderer.invoke('aliases:set', { alias, model }),
    getDefaults: () => ipcRenderer.invoke('aliases:getDefaults'),
  },

  // ── Registry ──
  registry: {
    get: () => ipcRenderer.invoke('registry:get'),
    checkUpgrades: () => ipcRenderer.invoke('registry:checkUpgrades'),
  },

  // ── Store ──
  store: {
    get: (key) => ipcRenderer.invoke('store:get', key),
    set: (key, value) => ipcRenderer.invoke('store:set', key, value),
  },

  // ── App ──
  app: {
    openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
  },

  // ── Tunnel ──
  tunnel: {
    getStatus: () => ipcRenderer.invoke('tunnel:getStatus'),
    copyUrl: () => ipcRenderer.invoke('tunnel:copyUrl'),
    restart: () => ipcRenderer.invoke('tunnel:restart'),
    onStatus: (cb) => {
      const handler = (event, data) => cb(data);
      ipcRenderer.on('tunnel:status', handler);
      return () => ipcRenderer.removeListener('tunnel:status', handler);
    },
  },

  // ── Auto-Updater ──
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    install: () => ipcRenderer.invoke('updater:install'),
    getStatus: () => ipcRenderer.invoke('updater:status'),
    onStatus: (cb) => {
      const handler = (event, data) => cb(data);
      ipcRenderer.on('updater:status', handler);
      return () => ipcRenderer.removeListener('updater:status', handler);
    },
  },
});
