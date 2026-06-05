import React, { useState, useEffect } from 'react';
import { useApp } from '../App';
import ModelHub from './ModelHub';
import ReplaceWizard from './ReplaceWizard';

export default function Settings() {
  const [section, setSection] = useState('system');
  const { bridge, systemInfo, hardwareTier, ollamaStatus, gatewayStatus, models, activeModel } = useApp();
  const [aliases, setAliases] = useState({});
  const [editingAlias, setEditingAlias] = useState(null);
  const [saved, setSaved] = useState(false);
  const [appVersion, setAppVersion] = useState('...');
  const [toolStates, setToolStates] = useState([]);

  useEffect(() => {
    if (bridge?.tools?.list) {
      bridge.tools.list().then(setToolStates).catch(() => {});
    }
  }, [bridge]);

  async function toggleTool(name, enabled) {
    if (!bridge?.tools?.setEnabled) return;
    // optimistic update
    setToolStates((prev) => prev.map((t) => (t.name === name ? { ...t, enabled } : t)));
    await bridge.tools.setEnabled(name, enabled);
    const updated = await bridge.tools.list();
    setToolStates(updated);
  }

  const TOOL_LABELS = {
    web_search: { icon: '🔍', title: 'Web Search', desc: 'Search the web for current info — runs from your machine, your IP. Nothing routed through Aspen.' },
    calculate: { icon: '🧮', title: 'Calculator', desc: 'Evaluate math expressions.' },
    get_datetime: { icon: '🕐', title: 'Date & Time', desc: 'Tell the assistant the current date, time, and timezone.' },
    fetch_url: { icon: '🌐', title: 'Read Web Page', desc: 'Fetch and read the text of a specific URL — from your machine.' },
    run_command: { icon: '💻', title: 'Run Commands', desc: 'Execute shell commands — clone repos, read/write files, run scripts. Works best with 12B+ models.' },
  };

  useEffect(() => {
    if (bridge?.app?.getVersion) {
      bridge.app.getVersion().then(v => setAppVersion(v)).catch(() => {});
    }
  }, [bridge]);

  useEffect(() => {
    if (bridge) {
      bridge.aliases.list().then(setAliases);
    }
  }, [bridge]);

  async function saveAlias(alias, model) {
    if (!bridge) return;
    await bridge.aliases.set(alias, model);
    setEditingAlias(null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    const updated = await bridge.aliases.list();
    setAliases(updated);
  }

  const installedModels = models.map((m) => m.name);

  const tabs = [{ id: 'system', label: 'System' }, { id: 'models', label: 'Models' }, { id: 'tools', label: 'Tools' }, { id: 'replace', label: 'Replace AI' }];

  return (
    <div className="page">
      <div className="page-title">⚙️ Settings</div>
      <div className="page-sub">Configure Aspen to work your way.</div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '2px solid rgba(93,78,55,0.1)', paddingBottom: 0 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setSection(t.id)} style={{ padding: '7px 16px', fontSize: 13, fontWeight: 600, background: 'transparent', border: 'none', cursor: 'pointer', color: section === t.id ? 'var(--earth)' : 'var(--text-light)', borderBottom: section === t.id ? '2px solid var(--pipe-yellow)' : '2px solid transparent', marginBottom: -2, borderRadius: 0, fontFamily: 'var(--font-display)' }}>{t.label}</button>
        ))}
      </div>
      {section === 'models' && <ModelHub />}
      {section === 'replace' && <ReplaceWizard />}
      {section === 'tools' && <div>
        <div className="card mb-6">
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--earth)', marginBottom: 6 }}>
            🛠️ Tools
          </h3>
          <p style={{ fontSize: 13, color: 'var(--text-light)', marginBottom: 16, lineHeight: 1.5 }}>
            Tools let your local model do things — search the web, do math, read pages.
            Everything runs on this machine; nothing is sent to Aspen's servers.
            All tools are on by default.
          </p>

          {/* Model-quality warning — dynamic based on active model */}
          {(() => {
            const m = (activeModel || '').toLowerCase();
            const isSmall = m.includes('e4b') || m.includes('e2b') || m.includes(':3b') || m.includes(':1b') || m.includes(':7b') || m.includes(':8b');
            const isRecommended = m.includes(':12b') || m.includes(':14b') || m.includes(':26b') || m.includes(':32b') || m.includes('scout');
            if (isSmall) return (
              <div style={{ background: 'rgba(220,53,69,0.10)', border: '1px solid rgba(220,53,69,0.35)', borderRadius: 8, padding: '10px 14px', marginBottom: 18, fontSize: 12.5, color: '#8b1a2b', lineHeight: 1.5 }}>
                ⚠️ Your current model <strong>{activeModel}</strong> is too small for reliable tool use. The model may refuse to call tools or make things up instead.
                Switch to <strong>Gemma 4 12B</strong> or <strong>Qwen 3 14B</strong> in the Models tab for tools to work properly.
              </div>
            );
            return (
              <div style={{ background: isRecommended ? 'rgba(40,167,69,0.10)' : 'rgba(212,160,23,0.12)', border: `1px solid ${isRecommended ? 'rgba(40,167,69,0.35)' : 'rgba(212,160,23,0.35)'}`, borderRadius: 8, padding: '10px 14px', marginBottom: 18, fontSize: 12.5, color: isRecommended ? '#155724' : 'var(--earth)', lineHeight: 1.5 }}>
                {isRecommended ? '✅' : '⚠️'} {isRecommended
                  ? `${activeModel} — good choice for tool calling.`
                  : `Tool use works best with 12B+ models. Your current model may occasionally skip a tool. Try a bigger model in the Models tab if results feel unreliable.`}
              </div>
            );
          })()}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {toolStates.map((t) => {
              const meta = TOOL_LABELS[t.name] || { icon: '🔧', title: t.name, desc: '' };
              return (
                <div key={t.name} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, padding: '12px 14px', background: 'rgba(93,78,55,0.04)', borderRadius: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--earth)', marginBottom: 2 }}>
                      {meta.icon} {meta.title}
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-light)', lineHeight: 1.4 }}>{meta.desc}</div>
                  </div>
                  <button
                    onClick={() => toggleTool(t.name, !t.enabled)}
                    aria-label={`Toggle ${meta.title}`}
                    style={{
                      flexShrink: 0, width: 44, height: 26, borderRadius: 13, border: 'none', cursor: 'pointer',
                      background: t.enabled ? 'var(--pipe-yellow)' : 'rgba(93,78,55,0.25)',
                      position: 'relative', transition: 'background 0.15s',
                    }}
                  >
                    <span style={{
                      position: 'absolute', top: 3, left: t.enabled ? 21 : 3, width: 20, height: 20,
                      borderRadius: '50%', background: '#fff', transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                    }} />
                  </button>
                </div>
              );
            })}
            {toolStates.length === 0 && (
              <div style={{ fontSize: 13, color: 'var(--text-light)' }}>Loading tools…</div>
            )}
          </div>
        </div>
      </div>}
      {section === 'system' && <div>

      {/* System Info */}
      <div className="card mb-6">
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--earth)', marginBottom: 12 }}>
          💻 Your Machine
        </h3>
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

      {/* Model Aliases */}
      <div className="card mb-6">
        <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--earth)' }}>
            🔀 Model Aliases
          </h3>
          {saved && <span className="badge badge-green">✓ Saved</span>}
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-light)', marginBottom: 16, lineHeight: 1.5 }}>
          When an app asks for "gpt-4", Aspen routes it to your local model. Edit the mappings below.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {Object.entries(aliases).map(([alias, target]) => (
            <div key={alias} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 12px',
              background: 'var(--sky-top)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 13,
            }}>
              <code style={{
                fontFamily: 'var(--font-mono)',
                fontWeight: 600,
                color: 'var(--text-dark)',
                minWidth: 150,
              }}>
                {alias}
              </code>
              <span style={{ color: 'var(--pipe-yellow)' }}>→</span>
              {editingAlias === alias ? (
                <select
                  defaultValue={target}
                  onChange={(e) => saveAlias(alias, e.target.value)}
                  onBlur={() => setEditingAlias(null)}
                  autoFocus
                  style={{
                    flex: 1, padding: '4px 8px',
                    borderRadius: 6, border: '1.5px solid var(--pipe-yellow)',
                    fontFamily: 'var(--font-mono)', fontSize: 12,
                  }}
                >
                  {installedModels.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              ) : (
                <code
                  style={{
                    flex: 1, fontFamily: 'var(--font-mono)',
                    color: 'var(--text-mid)', cursor: 'pointer',
                  }}
                  onClick={() => setEditingAlias(alias)}
                  title="Click to edit"
                >
                  {target}
                </code>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Status */}
      <div className="card mb-6">
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--earth)', marginBottom: 12 }}>
          📡 Service Status
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '8px 16px', fontSize: 14 }}>
          <span style={{ color: 'var(--text-light)', fontWeight: 600 }}>AI Engine</span>
          <span>
            {ollamaStatus.running ? (
              <span className="badge badge-green">Running</span>
            ) : (
              <span className="badge" style={{ background: 'rgba(231,76,60,0.1)', color: 'var(--danger)' }}>Offline</span>
            )}
          </span>
          <span style={{ color: 'var(--text-light)', fontWeight: 600 }}>API Gateway</span>
          <span>
            {gatewayStatus.running ? (
              <>
                <span className="badge badge-green">Running</span>
                <code style={{ marginLeft: 8, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-light)' }}>
                  :{gatewayStatus.port}
                </code>
              </>
            ) : (
              <span className="badge" style={{ background: 'rgba(231,76,60,0.1)', color: 'var(--danger)' }}>Offline</span>
            )}
          </span>
          <span style={{ color: 'var(--text-light)', fontWeight: 600 }}>Installed Models</span>
          <span>{models.length}</span>
        </div>
      </div>

      {/* About */}
      <div className="card">
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--earth)', marginBottom: 8 }}>
          About Aspen
        </h3>
        <p style={{ fontSize: 13, color: 'var(--text-light)', lineHeight: 1.6 }}>
          Aspen v{appVersion} · MIT License
          <br />
          Run the best open source AI locally. No subscriptions. No data sharing.
          <br /><br />
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              bridge?.app.openExternal('https://github.com/spideysense/OpenLLM');
            }}
            style={{ color: 'var(--water)', fontWeight: 600 }}
          >
            GitHub
          </a>
          {' · '}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              bridge?.app.openExternal('https://github.com/spideysense/OpenLLM/fork');
            }}
            style={{ color: 'var(--water)', fontWeight: 600 }}
          >
            Fork It
          </a>
        </p>
      </div>
    </div>}
    </div>
  );
}
