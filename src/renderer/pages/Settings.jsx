import React, { useState, useEffect } from 'react';
import { useApp } from '../App';

export default function Settings() {
  const { bridge, systemInfo, hardwareTier, ollamaStatus, gatewayStatus, models } = useApp();
  const [aliases, setAliases] = useState({});
  const [editingAlias, setEditingAlias] = useState(null);
  const [saved, setSaved] = useState(false);

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

  return (
    <div className="page">
      <div className="page-title">⚙️ Settings</div>
      <div className="page-sub">Configure LLM Bear to work your way.</div>

      {/* System Info */}
      <div className="card mb-6">
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--earth)', marginBottom: 12 }}>
          🐻 Your Machine
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
          When an app asks for "gpt-4", LLM Bear routes it to your local model. Edit the mappings below.
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
          About LLM Bear
        </h3>
        <p style={{ fontSize: 13, color: 'var(--text-light)', lineHeight: 1.6 }}>
          LLM Bear v0.1.0 · MIT License
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
    </div>
  );
}
