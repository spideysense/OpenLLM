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
        <svg viewBox="0 0 24 32" fill="none" width="22" height="28">
          <path d="M12 31L12 16" stroke="#B8860B" strokeWidth="1.3" strokeLinecap="round"/>
          <path d="M12 1C12 1,2 7,2 15.5C2 22,6.5 26,12 26C17.5 26,22 22,22 15.5C22 7,12 1,12 1Z" stroke="#B8860B" strokeWidth="1.2" fill="none"/>
          <path d="M12 5L12 23.5" stroke="#B8860B" strokeWidth="0.7" strokeLinecap="round"/>
          <path d="M12 11C9.5 13,6 14,4.5 14.8" stroke="#B8860B" strokeWidth="0.6" fill="none" strokeLinecap="round"/>
          <path d="M12 11C14.5 13,18 14,19.5 14.8" stroke="#B8860B" strokeWidth="0.6" fill="none" strokeLinecap="round"/>
          <path d="M12 16C9.5 18,6.5 19,5 19.8" stroke="#B8860B" strokeWidth="0.6" fill="none" strokeLinecap="round"/>
          <path d="M12 16C14.5 18,17.5 19,19 19.8" stroke="#B8860B" strokeWidth="0.6" fill="none" strokeLinecap="round"/>
        </svg>
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
