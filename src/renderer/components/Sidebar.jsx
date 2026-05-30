import React, { useState, useEffect } from 'react';
import { useApp } from '../App';

export default function Sidebar() {
  const { page, setPage, ollamaStatus, activeModel, gatewayStatus, bridge } = useApp();
  const [updateStatus, setUpdateStatus] = useState(null);

  useEffect(() => {
    if (!bridge?.updater) return;
    const unsub = bridge.updater.onStatus((data) => {
      setUpdateStatus(data);
    });
    return unsub;
  }, [bridge]);

  const nav = [
    { id: 'chat', icon: '💬', label: 'Chat' },
    { id: 'models', icon: '🖼️', label: 'Models' },
    { id: 'replace', icon: '🔌', label: 'Replace AI' },
    { id: 'apikeys', icon: '🔑', label: 'API Keys' },
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
        <button onClick={() => bridge?.updater.install()} className="update-banner">
          <span>🎉</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 12 }}>Update ready</div>
            <div style={{ fontSize: 11, opacity: 0.8 }}>v{updateStatus.version} — click to restart</div>
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
          <div style={{ fontWeight: 700, color: 'var(--earth)', marginBottom: 2 }}>
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
    </aside>
  );
}
