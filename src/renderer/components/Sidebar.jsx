import React, { useState, useEffect } from 'react';
import { useApp } from '../App';

export default function Sidebar() {
  const { page, setPage, ollamaStatus, activeModel, gatewayStatus, bridge } = useApp();
  const [updateStatus, setUpdateStatus] = useState(null);
  const [appVersion, setAppVersion] = useState('...');

  useEffect(() => {
    if (bridge?.app?.getVersion) {
      bridge.app.getVersion().then(setAppVersion).catch(() => {});
    }
  }, [bridge]);

  useEffect(() => {
    if (!bridge?.updater) return;
    const unsub = bridge.updater.onStatus((data) => { setUpdateStatus(data); });
    return unsub;
  }, [bridge]);

  useEffect(() => {
    if (!bridge?.hotUpdater) return;
    const unsub = bridge.hotUpdater.onStatus((data) => {
      setUpdateStatus(data);
    });
    return unsub;
  }, [bridge]);

  const nav = [
    { id: 'home', icon: '🏠', label: 'Home' },
    { id: 'chat', icon: '💬', label: 'Chat' },
    { id: 'templates', icon: '📋', label: 'Templates' },
    { id: 'worldmodel', icon: '🧠', label: 'World Model' },
    { id: 'apikeys', icon: '🔑', label: 'API Keys' },
    { id: 'appsetup', icon: '📱', label: 'App Setup' },
    { id: 'connectors', icon: '🔌', label: 'Connectors' },
    { id: 'settings', icon: '⚙️', label: 'Settings' },
  ];

  function handleInstallUpdate() {
    if (bridge?.updater) bridge.updater.install();
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <img src="data:image/png;base64,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" alt="Aspen" width="24" height="24" style={{borderRadius:4}} />
        <span>ASPEN</span>
        <span style={{ fontSize: 9, fontWeight: 700, background: 'var(--gold, #b8860b)', color: '#fff', padding: '1px 5px', borderRadius: 4, letterSpacing: '.5px', marginLeft: 4 }}>BETA</span>
      </div>

      {nav.map((item) => (
        <button
          key={item.id}
          className={`nav-item ${page === item.id ? 'active' : ''}`}
          onClick={() => setPage(item.id)}
        >
          <span className="nav-icon">{item.icon}</span>
          {item.label}
        </button>
      ))}

      <div className="nav-spacer" />

      {/* Update notification — quiet, no countdowns */}
      {updateStatus?.status === 'ready' && (
        <button onClick={handleInstallUpdate} className="update-banner">
          <span>🎉</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 12 }}>Update ready</div>
            <div style={{ fontSize: 11, opacity: 0.8 }}>v{updateStatus.version} — click to restart &amp; update</div>
          </div>
        </button>
      )}
      {updateStatus?.status === 'downloading' && (
        <div className="update-banner" style={{ cursor: 'default' }}>
          <span>⬇️</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 12 }}>Downloading update...</div>
            <div style={{ fontSize: 11, opacity: 0.8 }}>{updateStatus.percent || 0}%</div>
          </div>
        </div>
      )}

      {activeModel && (
        <div style={{
          padding: '8px 14px',
          fontSize: '12px',
          color: 'var(--text-light)',
          borderRadius: 'var(--radius-sm)',
          background: 'rgba(93,78,55,0.04)',
        }}>
          <div style={{ fontWeight: 700, color: 'var(--bk, #1D1D1F)', marginBottom: 2 }}>
            Active Model
          </div>
          <div className="truncate">{activeModel}</div>
        </div>
      )}

      <div className={`nav-status ${ollamaStatus.running ? '' : 'offline'}`}>
        <span className="dot" />
        {ollamaStatus.running ? (
          <span>Running locally · :{gatewayStatus.port}</span>
        ) : (
          <span>AI engine offline</span>
        )}
      </div>
      <div style={{ padding: '6px 14px', fontSize: 10, color: 'var(--t4, #AEAEB2)', letterSpacing: '.02em' }}>v{appVersion}</div>
    </aside>
  );
}
