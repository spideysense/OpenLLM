import React, { useState, useEffect } from 'react';
import { useApp } from '../App';
import ModelHub from './ModelHub';
import ReplaceWizard from './ReplaceWizard';
import WorldModel from './WorldModel';
import AppSetup from './AppSetup';
import Connectors from './Connectors';
import APIKeys from './APIKeys';

const TOOL_LABELS = {
  web_search: { icon: '🔍', title: 'Web Search', desc: 'Search the web for current info — runs from your machine, your IP. Nothing routed through Aspen.' },
  calculate: { icon: '🧮', title: 'Calculator', desc: 'Evaluate math expressions.' },
  get_datetime: { icon: '🕐', title: 'Date & Time', desc: 'Tell the assistant the current date, time, and timezone.' },
  fetch_url: { icon: '🌐', title: 'Read Web Page', desc: 'Fetch and read the text of a specific URL — from your machine.' },
  run_command: { icon: '💻', title: 'Run Commands', desc: 'Execute shell commands — clone repos, read/write files, run scripts. Works best with 12B+ models.' },
  computer_use: { icon: '🖥️', title: 'Computer Use', desc: 'Let Aspen see your screen and control your mouse and keyboard to complete tasks autonomously. Owner key only.' },
  deep_research: { icon: '🔬', title: 'Deep Research', desc: 'Multi-step web search + synthesis for thorough research on any topic.' },
};

// One stop in the settings jump-nav.
const SECTIONS = [
  { id: 'set-models', label: 'Models' },
  { id: 'set-tools', label: 'Tools' },
  { id: 'set-memory', label: 'Memory' },
  { id: 'set-appsetup', label: 'App Setup' },
  { id: 'set-connectors', label: 'Connectors' },
  { id: 'set-apikeys', label: 'API Keys' },
  { id: 'set-replace', label: 'Replace AI' },
  { id: 'set-system', label: 'System' },
];

export default function Settings() {
  const { bridge, systemInfo, hardwareTier, models, activeModel, modelCaps, modelProfile } = useApp();
  const [appVersion, setAppVersion] = useState('...');
  const [toolStates, setToolStates] = useState([]);
  const [customInstructions, setCustomInstructions] = useState('');

  useEffect(() => {
    if (bridge?.store) bridge.store.get('customInstructions').then(v => { if (v && typeof v === 'string') setCustomInstructions(v); }).catch(() => {});
  }, [bridge]);

  useEffect(() => {
    if (bridge?.tools?.list) bridge.tools.list().then(setToolStates).catch(() => {});
  }, [bridge]);

  useEffect(() => {
    if (bridge?.app?.getVersion) bridge.app.getVersion().then(setAppVersion).catch(() => {});
  }, [bridge]);

  async function toggleTool(name, enabled) {
    if (!bridge?.tools?.setEnabled) return;
    setToolStates((prev) => prev.map((t) => (t.name === name ? { ...t, enabled } : t)));
    await bridge.tools.setEnabled(name, enabled);
    const updated = await bridge.tools.list();
    setToolStates(updated);
  }

  function jump(id) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="settings-scroll">
      {/* Sticky jump-nav — one long page, anchored sections */}
      <div className="settings-nav">
        <div className="settings-nav-inner">
          <span className="settings-nav-title">⚙️ Settings</span>
          <div className="settings-nav-links">
            {SECTIONS.map((s) => (
              <button key={s.id} onClick={() => jump(s.id)}>{s.label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Custom Instructions */}
      <section className="settings-section settings-pad">
        <div className="card">
          <div className="card-title">📝 Custom Instructions</div>
          <div className="card-sub" style={{ marginBottom: 8 }}>Tell Aspen about yourself and how you'd like it to respond. These are prepended to every conversation.</div>
          <textarea
            value={customInstructions}
            onChange={(e) => { setCustomInstructions(e.target.value); bridge?.store?.set('customInstructions', e.target.value); }}
            placeholder="e.g., I'm a software engineer. Be technical and concise. Always include code examples. Respond in Spanish."
            style={{ width: '100%', minHeight: 80, padding: 10, border: '1.5px solid rgba(0,0,0,.12)', borderRadius: 8, fontSize: 14, fontFamily: 'var(--font-body)', resize: 'vertical', background: 'var(--cloud)', color: 'var(--text-dark)', boxSizing: 'border-box' }}
          />
        </div>
      </section>

      {/* Models */}
      <section id="set-models" className="settings-section"><ModelHub /></section>

      {/* Tools */}
      <section id="set-tools" className="settings-section settings-pad">
        <div className="card">
          <h3 className="settings-h3">🛠️ Tools</h3>
          <p style={{ fontSize: 14, color: 'var(--text-light)', marginBottom: 16, lineHeight: 1.5 }}>
            Tools let your local model do things — search the web, do math, read pages.
            Everything runs on this machine; nothing is sent to Aspen's servers.
          </p>

          {activeModel && modelProfile && (() => {
            const tone = modelProfile.tier === 'chat'
              ? { bg: 'rgba(242,213,138,0.16)', bd: 'rgba(0,0,0,0.3)', fg: '#7a5e12' }
              : { bg: 'rgba(40,167,69,0.08)', bd: 'rgba(40,167,69,0.25)', fg: '#155724' };
            return (
              <div style={{ background: tone.bg, border: `1px solid ${tone.bd}`, borderRadius: 8, padding: '10px 14px', marginBottom: 18, fontSize: 13, color: tone.fg, lineHeight: 1.6 }}>
                <strong>{activeModel}</strong>{modelProfile.sizeB ? ` (~${modelProfile.sizeB}B)` : ''} — {modelProfile.tagline}
                {modelProfile.tier !== 'chat' && !modelProfile.features.computerUse && modelProfile.reasons?.computerUse && (
                  <div style={{ marginTop: 4, opacity: 0.85 }}>Computer use: {modelProfile.reasons.computerUse}.</div>
                )}
                {modelProfile.tier !== 'chat' && !modelProfile.features.deepResearch && modelProfile.reasons?.deepResearch && (
                  <div style={{ marginTop: 2, opacity: 0.85 }}>Deep research: {modelProfile.reasons.deepResearch}.</div>
                )}
              </div>
            );
          })()}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {toolStates
              .filter((t) => {
                if (t.name === 'computer_use' && !modelProfile?.vision && !modelCaps?.vision) return false;
                return true;
              })
              .map((t) => {
                const meta = TOOL_LABELS[t.name] || { icon: '🔧', title: t.name, desc: '' };
                const allowed = modelProfile ? modelProfile.allowedTools.includes(t.name) : !!modelCaps?.tools;
                const disabled = !allowed;
                const reason = disabled && modelProfile
                  ? (t.name === 'computer_use' ? modelProfile.reasons?.computerUse
                     : t.name === 'deep_research' ? modelProfile.reasons?.deepResearch
                     : modelProfile.reasons?.tools)
                  : null;
                return (
                  <div key={t.name} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, padding: '12px 14px', background: 'rgba(0,0,0,0.04)', borderRadius: 8, opacity: disabled ? 0.5 : 1 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--earth)', marginBottom: 2 }}>{meta.icon} {meta.title}</div>
                      <div style={{ fontSize: 13, color: 'var(--text-light)', lineHeight: 1.4 }}>{meta.desc}</div>
                      {reason && <div style={{ fontSize: 12, color: '#8a6d1b', marginTop: 3 }}>Unavailable — {reason}.</div>}
                    </div>
                    <button
                      onClick={() => !disabled && toggleTool(t.name, !t.enabled)}
                      aria-label={`Toggle ${meta.title}`}
                      disabled={disabled}
                      style={{ flexShrink: 0, width: 44, height: 26, borderRadius: 13, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', background: (t.enabled && !disabled) ? 'var(--pipe-yellow)' : 'rgba(0,0,0,0.25)', position: 'relative', transition: 'background 0.15s' }}
                    >
                      <span style={{ position: 'absolute', top: 3, left: (t.enabled && !disabled) ? 21 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                    </button>
                  </div>
                );
              })}
            {toolStates.length === 0 && (<div style={{ fontSize: 14, color: 'var(--text-light)' }}>Loading tools…</div>)}
          </div>
        </div>
      </section>

      {/* Memory (World Model) */}
      <section id="set-memory" className="settings-section"><WorldModel /></section>

      {/* App Setup */}
      <section id="set-appsetup" className="settings-section"><AppSetup /></section>

      {/* Connectors */}
      <section id="set-connectors" className="settings-section"><Connectors /></section>

      {/* API Keys */}
      <section id="set-apikeys" className="settings-section"><APIKeys /></section>

      {/* Replace AI */}
      <section id="set-replace" className="settings-section"><ReplaceWizard /></section>

      {/* System + About */}
      <section id="set-system" className="settings-section settings-pad">
        <div className="card mb-6">
          <h3 className="settings-h3">💻 Your Machine</h3>
          {systemInfo ? (
            <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '8px 16px', fontSize: 14 }}>
              <span style={{ color: 'var(--text-light)', fontWeight: 600 }}>Machine</span>
              <span>{systemInfo.machineName}</span>
              <span style={{ color: 'var(--text-light)', fontWeight: 600 }}>CPU</span>
              <span>{systemInfo.cpu}</span>
              <span style={{ color: 'var(--text-light)', fontWeight: 600 }}>RAM</span>
              <span>{systemInfo.totalRAMGB} GB</span>
              <span style={{ color: 'var(--text-light)', fontWeight: 600 }}>GPU</span>
              <span>{systemInfo.gpu.name} ({systemInfo.gpu.type})</span>
              <span style={{ color: 'var(--text-light)', fontWeight: 600 }}>Hardware Tier</span>
              <span className="badge badge-yellow">{hardwareTier}</span>
            </div>
          ) : (
            <p style={{ color: 'var(--text-light)', fontSize: 14 }}>Loading system info...</p>
          )}
        </div>

        <div className="card">
          <h3 className="settings-h3">About Aspen</h3>
          <p style={{ fontSize: 14, color: 'var(--text-light)', lineHeight: 1.6 }}>
            Aspen v{appVersion} · MIT License
            <br />
            Run the best open source AI locally. No subscriptions. No data sharing.
            <br /><br />
            <a href="#" onClick={(e) => { e.preventDefault(); bridge?.app.openExternal('https://github.com/spideysense/OpenLLM'); }} style={{ color: 'var(--water)', fontWeight: 600 }}>GitHub</a>
            {' · '}
            <a href="#" onClick={(e) => { e.preventDefault(); bridge?.app.openExternal('https://github.com/spideysense/OpenLLM/fork'); }} style={{ color: 'var(--water)', fontWeight: 600 }}>Fork It</a>
          </p>
        </div>
      </section>
    </div>
  );
}
