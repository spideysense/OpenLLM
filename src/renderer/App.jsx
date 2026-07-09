import React, { useState, useEffect, useRef, createContext, useContext, useCallback } from 'react';
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
import Templates from './pages/Templates';
import Home from './pages/Home';

// ═══════════════════════════════════════════════════
// Global App Context
// ═══════════════════════════════════════════════════

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

// Safe bridge access (works in both Electron and browser)
const bridge = typeof window !== 'undefined' && window.aspen ? window.aspen : null;

export default function App() {
  const [page, setPage] = useState('home');
  const [ollamaStatus, setOllamaStatus] = useState({ installed: false, running: false });
  const [systemInfo, setSystemInfo] = useState(null);
  const [hardwareTier, setHardwareTier] = useState('medium');
  const [models, setModels] = useState([]);
  const [activeModel, setActiveModel] = useState(null);
  // Model warming: the big model (e.g. llama4:scout, 67GB) takes time to load
  // into VRAM. We warm it on startup + on switch, and block chat behind a
  // progress screen until it's actually resident, so the first message is
  // instant instead of a multi-minute cold wait.
  const [modelWarming, setModelWarming] = useState(false);
  const [warmingModel, setWarmingModel] = useState(null);
  const [warmElapsed, setWarmElapsed] = useState(0);
  const [modelCaps, setModelCaps] = useState({ tools: false, vision: false });
  const [modelProfile, setModelProfile] = useState(null);
  const [showComputerUseOnboarding, setShowComputerUseOnboarding] = useState(false);
  const [gatewayStatus, setGatewayStatus] = useState({ running: false, port: 4000, url: 'http://localhost:4000/v1' });
  const [isOnboarded, setIsOnboarded] = useState(true);
  const [loading, setLoading] = useState(true);
  const [modelUpgrade, setModelUpgrade] = useState(null);
  const [betaDismissed, setBetaDismissed] = useState(false);
  // Conversations live here (lifted from Chat) so the sidebar can own the list, Ollama-style.
  const [conversations, setConversations] = useState([{ id: 1, title: 'New Chat', messages: [] }]);
  const [activeConvo, setActiveConvo] = useState(1);
  const [missions, setMissions] = useState([]);
  const [viewingMissionId, setViewingMissionId] = useState(null);
  const saveTimer = useRef(null);

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

  // ─── Fetch the capability profile whenever the active model changes ───
  // The profile (tier + per-feature gating from model size, tools/vision, and
  // hardware) is the single source of truth for what the UI offers.
  useEffect(() => {
    if (!bridge?.ollama?.getModelProfile || !activeModel) return;
    bridge.ollama.getModelProfile(activeModel).then(async (profile) => {
      if (!profile) return;
      setModelProfile(profile);
      // Back-compat: existing UI reads modelCaps {tools, vision}.
      setModelCaps({ tools: !!profile.features?.webSearch, vision: !!profile.vision });
      // Computer use is now a full capability decision (vision + size + hardware).
      if (profile.features?.computerUse) {
        const onboarded = await bridge.store.get('computerUseOnboarded');
        if (!onboarded) setShowComputerUseOnboarding(true);
      }
      if (bridge?.tools?.setEnabled) {
        await bridge.tools.setEnabled('computer_use', !!profile.features?.computerUse);
      }
    }).catch(() => {});
  }, [activeModel]);


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

  // ─── Warm a model into VRAM, showing a blocking progress screen ───
  const warmActiveModel = useCallback(async (modelName) => {
    if (!modelName || !bridge?.models?.warm) return;
    setWarmingModel(modelName);
    setModelWarming(true);
    setWarmElapsed(0);
    const startedAt = Date.now();
    const ticker = setInterval(() => {
      setWarmElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    try {
      await bridge.models.warm(modelName);
    } catch {}
    clearInterval(ticker);
    setModelWarming(false);
  }, [bridge]);

  // ─── Select model (warms the new one before chat is usable) ───
  const selectModel = useCallback(async (modelName) => {
    if (!modelName) return;
    setActiveModel(modelName);
    if (bridge) {
      await bridge.store.set('activeModel', modelName);
    }
    // Warm the newly selected model so the first message is instant.
    warmActiveModel(modelName);
  }, [bridge, warmActiveModel]);

  // ─── Warm the active model on startup so the first message is instant ───
  const warmedOnceRef = useRef(false);
  useEffect(() => {
    if (warmedOnceRef.current) return;
    if (loading || !activeModel || !isOnboarded) return;
    warmedOnceRef.current = true;
    warmActiveModel(activeModel);
  }, [loading, activeModel, isOnboarded, warmActiveModel]);

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

  // ─── Conversations: load once on mount, persist on change (debounced) ───
  useEffect(() => {
    if (!bridge?.conversations) return;
    bridge.conversations.load().then((saved) => {
      if (saved && saved.length > 0) {
        setConversations(saved);
        setActiveConvo(saved[saved.length - 1].id);
      }
    }).catch(() => {});
  }, [bridge]);

  useEffect(() => {
    if (!bridge?.conversations || conversations.length === 0) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      bridge.conversations.save(conversations).catch(() => {});
    }, 800);
    return () => clearTimeout(saveTimer.current);
  }, [bridge, conversations]);

  useEffect(() => {
    if (!bridge?.missions?.list) return;
    let alive = true;
    const pull = () => bridge.missions.list().then((m) => { if (alive) setMissions(Array.isArray(m) ? m : []); }).catch(() => {});
    pull();
    const t = setInterval(pull, 15000);
    return () => { alive = false; clearInterval(t); };
  }, [bridge]);

  const newConvo = useCallback(() => {
    const id = Date.now();
    setViewingMissionId(null);
    setConversations((prev) => [...prev, { id, title: 'New Chat', messages: [] }]);
    setActiveConvo(id);
    setPage('chat');
  }, []);

  const deleteConvo = useCallback((id) => {
    setConversations((prev) => {
      const remaining = prev.filter((c) => c.id !== id);
      if (remaining.length === 0) {
        const fresh = { id: Date.now(), title: 'New Chat', messages: [] };
        setActiveConvo(fresh.id);
        return [fresh];
      }
      setActiveConvo((cur) => (id === cur ? remaining[remaining.length - 1].id : cur));
      return remaining;
    });
    bridge?.conversations?.delete(id).catch(() => {});
  }, [bridge]);

  // ─── Context value ───
  const ctx = {
    bridge,
    page, setPage,
    ollamaStatus, setOllamaStatus,
    systemInfo, hardwareTier,
    models, refreshModels,
    activeModel, selectModel,
    modelCaps,
    modelProfile,
    gatewayStatus,
    isOnboarded, completeOnboarding,
    conversations, setConversations,
    activeConvo, setActiveConvo,
    missions, setMissions,
    viewingMissionId, setViewingMissionId,
    newConvo, deleteConvo,
  };

  // ─── Loading ───
  if (loading) {
    return (
      <div className="onboarding">
        <div className="onboarding-icon"></div>
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

      {/* ── Model Warming Overlay — blocks chat until the model is in VRAM ── */}
      {modelWarming && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'var(--bg, #faf8f3)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          zIndex: 99999, padding: 24, textAlign: 'center',
        }}>
          <div className="onboarding-icon" style={{ marginBottom: 24 }}></div>
          <h2 style={{ margin: '0 0 8px', fontFamily: 'var(--serif, Georgia)', fontWeight: 600, color: 'var(--text, #2a2118)' }}>
            Preparing {warmingModel}
          </h2>
          <p style={{ margin: '0 0 4px', color: 'var(--text-light, #6b5d48)', maxWidth: 420, lineHeight: 1.5 }}>
            Loading the model into your machine's memory. This happens once — after
            this, every response is near-instant.
          </p>
          <p style={{ margin: '12px 0 0', fontSize: 14, color: 'var(--text-light, #8a7d68)', fontVariantNumeric: 'tabular-nums' }}>
            {warmElapsed}s — large models can take a minute or two to load
          </p>
          <div style={{
            marginTop: 24, width: 240, height: 4, borderRadius: 4,
            background: 'rgba(0,0,0,0.08)', overflow: 'hidden',
          }}>
            <div style={{
              height: '100%', width: '40%', borderRadius: 4,
              background: 'var(--accent, #c0552e)',
              animation: 'warming-slide 1.4s ease-in-out infinite',
            }} />
          </div>
          <style>{`@keyframes warming-slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(350%); } }`}</style>
        </div>
      )}


      {/* ── Computer Use Onboarding Modal ── */}
      {showComputerUseOnboarding && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999, padding: 24,
        }}>
          <div style={{
            background: 'var(--bg-card, #fff)', borderRadius: 16, padding: 32,
            maxWidth: 480, width: '100%', boxShadow: '0 24px 60px rgba(0,0,0,0.25)',
          }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🖥️</div>
            <h2 style={{ margin: '0 0 8px', fontSize: 20 }}>Aspen can control your computer</h2>
            <p style={{ color: 'var(--text-light, #6e6e73)', fontSize: 14, lineHeight: 1.6, margin: '0 0 20px' }}>
              Your model supports <strong>Computer Use</strong> — Aspen can take screenshots,
              move your mouse, click, and type to complete tasks on your behalf.
              Ask it to "open Safari and search for X" or "fill out this form" and it'll do it.
            </p>
            <div style={{ background: 'rgba(0,0,0,0.07)', borderRadius: 10, padding: '12px 16px', marginBottom: 20, fontSize: 13, lineHeight: 1.6 }}>
              <strong>⚠️ This requires one permission:</strong><br/>
              macOS will ask you to grant <em>Accessibility access</em> to Aspen the first time it tries to control your screen.
              This is a standard macOS privacy prompt — click Allow when it appears.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                style={{
                  background: 'linear-gradient(135deg,#171717,#daa520)', color: '#fff',
                  border: 'none', borderRadius: 10, padding: '12px 20px',
                  fontSize: 15, fontWeight: 600, cursor: 'pointer',
                }}
                onClick={async () => {
                  await bridge.tools.setEnabled('computer_use', true);
                  await bridge.store.set('computerUseOnboarded', true);
                  setShowComputerUseOnboarding(false);
                }}
              >
                Enable Computer Use
              </button>
              <button
                style={{
                  background: 'transparent', color: 'var(--text-light, #6e6e73)',
                  border: '1px solid var(--border, #e5e5ea)', borderRadius: 10,
                  padding: '10px 20px', fontSize: 14, cursor: 'pointer',
                }}
                onClick={async () => {
                  await bridge.tools.setEnabled('computer_use', false);
                  await bridge.store.set('computerUseOnboarded', true);
                  setShowComputerUseOnboarding(false);
                }}
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="app-layout">
        <Sidebar />
        <main className="main-content">
          {!betaDismissed && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              padding: '7px 16px', background: 'linear-gradient(90deg,#171717,#daa520)',
              color: '#fff', fontSize: 12.5, flexShrink: 0,
            }}>
              <span><strong>Aspen is in Beta.</strong> We'd love your feedback — <a href="mailto:mayank.mehta@gmail.com?subject=Aspen%20Beta%20Feedback" style={{ color: '#fff', textDecoration: 'underline' }}>tell us what you think</a>.</span>
              <button onClick={() => setBetaDismissed(true)} style={{ background: 'rgba(255,255,255,.25)', border: 'none', color: '#fff', width: 18, height: 18, borderRadius: '50%', cursor: 'pointer', fontSize: 12, lineHeight: 1, flexShrink: 0 }} aria-label="Dismiss">×</button>
            </div>
          )}

          {/* ── No-tools warning banner ── */}
          {activeModel && !modelCaps.tools && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 16px', background: 'rgba(255,59,48,0.08)',
              borderBottom: '1px solid rgba(255,59,48,0.15)',
              fontSize: 12.5, color: '#c0392b', flexShrink: 0,
            }}>
              <span>⚠️</span>
              <span><strong>{activeModel}</strong> doesn't support tools — web search, calculator, and computer use are disabled. Switch to a model like <strong>qwen2.5</strong>, <strong>llama3</strong>, or <strong>gemma3</strong> for full features.</span>
              <button onClick={() => setPage('settings')} style={{ marginLeft: 'auto', flexShrink: 0, background: 'rgba(255,59,48,0.1)', border: '1px solid rgba(255,59,48,0.3)', color: '#c0392b', borderRadius: 6, padding: '3px 10px', fontSize: 12, cursor: 'pointer' }}>Switch model</button>
            </div>
          )}

          {modelUpgrade && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
              padding: '10px 16px', margin: '12px 16px 0', borderRadius: 10,
              background: 'rgba(0,0,0,0.08)', border: '1px solid rgba(0,0,0,0.25)',
              fontSize: 13, color: 'var(--bk, #1D1D1F)',
            }}>
              <span>{modelUpgrade.message} — better for your machine.</span>
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
          {page === 'templates' && <Templates />}
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
