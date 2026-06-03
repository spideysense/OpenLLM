import React, { useState, useEffect, createContext, useContext, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import Onboarding from './pages/Onboarding';
import Chat from './pages/Chat';
import ModelHub from './pages/ModelHub';
import ReplaceWizard from './pages/ReplaceWizard';
import APIKeys from './pages/APIKeys';
import Settings from './pages/Settings';
import Connectors from './pages/Connectors';
import AppSetup from './pages/AppSetup';
import WorldModel from './pages/WorldModel';
import Home from './pages/Home';

// ═══════════════════════════════════════════════════
// Global App Context
// ═══════════════════════════════════════════════════

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

// Safe bridge access (works in both Electron and browser)
const bridge = typeof window !== 'undefined' && window.aspen ? window.aspen : null;

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
  const [modelUpgrade, setModelUpgrade] = useState(null);

  useEffect(() => {
    if (!bridge?.registry?.onUpgradeAvailable) return;
    const unsub = bridge.registry.onUpgradeAvailable((upgrades) => {
      if (upgrades && upgrades.length > 0) setModelUpgrade(upgrades[0]);
    });
    return unsub;
  }, []);

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
    if (!modelName) return;
    setActiveModel(modelName);
    if (bridge) {
      await bridge.store.set('activeModel', modelName);
    }
  }, []);

  // Keep activeModel honest: if it ever points at a model that isn't actually
  // installed (e.g. a download that failed, or a stale stored value), fall back
  // to the first installed model so the UI never shows a phantom active model.
  useEffect(() => {
    if (!activeModel || models.length === 0) return;
    const installed = models.some((m) => m.name === activeModel);
    if (!installed) {
      const fallback = models[0].name;
      setActiveModel(fallback);
      bridge?.store?.set('activeModel', fallback);
    }
  }, [activeModel, models]);

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
        <div className="onboarding-icon">🌿</div>
        <p style={{ color: 'var(--text-light)' }}>Waking up Aspen...</p>
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
          {modelUpgrade && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
              padding: '10px 16px', margin: '12px 16px 0', borderRadius: 10,
              background: 'rgba(184,134,11,0.08)', border: '1px solid rgba(184,134,11,0.25)',
              fontSize: 13, color: 'var(--bk, #1D1D1F)',
            }}>
              <span>🌿 {modelUpgrade.message} — better for your machine.</span>
              <span style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button className="btn btn-sm btn-primary" onClick={() => { setPage('settings'); setModelUpgrade(null); }}>
                  View
                </button>
                <button className="btn btn-sm" onClick={() => {
                  bridge?.registry?.dismissUpgrade?.(modelUpgrade.recommended.model);
                  setModelUpgrade(null);
                }} style={{ background: 'transparent', color: 'var(--text-light)' }}>
                  Dismiss
                </button>
              </span>
            </div>
          )}
          {page === 'home' && <Home />}
          {page === 'chat' && <Chat />}
          {page === 'worldmodel' && <WorldModel />}
          {page === 'apikeys' && <APIKeys />}
          {page === 'appsetup' && <AppSetup />}
          {page === 'connectors' && <Connectors />}
          {page === 'settings' && <Settings />}
        </main>
      </div>
    </AppContext.Provider>
  );
}
