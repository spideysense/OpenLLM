import React, { useState, useEffect, createContext, useContext, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import Onboarding from './pages/Onboarding';
import Chat from './pages/Chat';
import ModelHub from './pages/ModelHub';
import ReplaceWizard from './pages/ReplaceWizard';
import APIKeys from './pages/APIKeys';
import Settings from './pages/Settings';

// ═══════════════════════════════════════════════════
// Global App Context
// ═══════════════════════════════════════════════════

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

// Safe bridge access (works in both Electron and browser)
const bridge = typeof window !== 'undefined' && window.monet ? window.monet : null;

export default function App() {
  const [page, setPage] = useState('chat');
  const [ollamaStatus, setOllamaStatus] = useState({ installed: false, running: false });
  const [systemInfo, setSystemInfo] = useState(null);
  const [hardwareTier, setHardwareTier] = useState('medium');
  const [models, setModels] = useState([]);
  const [activeModel, setActiveModel] = useState(null);
  const [gatewayStatus, setGatewayStatus] = useState({ running: false, port: 4000, url: 'http://localhost:4000/v1' });
  const [isOnboarded, setIsOnboarded] = useState(true);
  const [loading, setLoading] = useState(true);

  // ─── Initial load ───
  useEffect(() => {
    async function init() {
      if (!bridge) {
        // Dev mode without Electron — use mock data
        setLoading(false);
        setIsOnboarded(false);
        return;
      }

      try {
        const [status, info, tier, onboarded] = await Promise.all([
          bridge.ollama.status(),
          bridge.system.getInfo(),
          bridge.system.getHardwareTier(),
          bridge.store.get('onboarded'),
        ]);

        setOllamaStatus(status);
        setSystemInfo(info);
        setHardwareTier(tier);
        setIsOnboarded(!!onboarded);

        if (status.running) {
          const modelList = await bridge.models.list();
          setModels(modelList);
          const savedModel = await bridge.store.get('activeModel');
          if (savedModel && modelList.some((m) => m.name === savedModel)) {
            setActiveModel(savedModel);
          } else if (modelList.length > 0) {
            setActiveModel(modelList[0].name);
          }
        }

        const gw = await bridge.gateway.status();
        setGatewayStatus(gw);
      } catch (e) {
        console.error('Init error:', e);
      }
      setLoading(false);
    }
    init();
  }, []);

  // ─── Refresh models ───
  const refreshModels = useCallback(async () => {
    if (!bridge) return;
    const modelList = await bridge.models.list();
    setModels(modelList);
    return modelList;
  }, []);

  // ─── Listen for Ollama status push (main process polls every 5s) ───
  useEffect(() => {
    if (!bridge?.ollama?.onStatus) return;
    const unsub = bridge.ollama.onStatus((status) => {
      setOllamaStatus(status);
      if (status.running) refreshModels();
    });
    return unsub;
  }, [bridge, refreshModels]);

  // ─── Select model ───
  const selectModel = useCallback(async (modelName) => {
    setActiveModel(modelName);
    if (bridge) {
      await bridge.store.set('activeModel', modelName);
    }
  }, []);

  // ─── Complete onboarding ───
  const completeOnboarding = useCallback(async () => {
    setIsOnboarded(true);
    setPage('chat');
    if (bridge) {
      await bridge.store.set('onboarded', true);
    }
    await refreshModels();
  }, [refreshModels]);

  // ─── Context value ───
  const ctx = {
    bridge,
    page, setPage,
    ollamaStatus, setOllamaStatus,
    systemInfo, hardwareTier,
    models, refreshModels,
    activeModel, selectModel,
    gatewayStatus,
    isOnboarded, completeOnboarding,
  };

  // ─── Loading ───
  if (loading) {
    return (
      <div className="onboarding">
        <div className="onboarding-bear">🎨</div>
        <p style={{ color: 'var(--text-light)' }}>Waking up the bear...</p>
      </div>
    );
  }

  // ─── Onboarding ───
  if (!isOnboarded) {
    return (
      <AppContext.Provider value={ctx}>
        <div className="titlebar-drag" />
        <Onboarding />
      </AppContext.Provider>
    );
  }

  // ─── Main App ───
  return (
    <AppContext.Provider value={ctx}>
      <div className="titlebar-drag" />
      <div className="app-layout">
        <Sidebar />
        <main className="main-content">
          {page === 'chat' && <Chat />}
          {page === 'models' && <ModelHub />}
          {page === 'replace' && <ReplaceWizard />}
          {page === 'apikeys' && <APIKeys />}
          {page === 'settings' && <Settings />}
        </main>
      </div>
    </AppContext.Provider>
  );
}
