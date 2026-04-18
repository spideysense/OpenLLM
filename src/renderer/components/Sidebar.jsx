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
        <svg viewBox="0 0 40 40" fill="none" width="32" height="32">
          <circle cx="20" cy="20" r="18" fill="#B08040"/>
          <circle cx="13" cy="15" r="3" fill="#2D3436"/>
          <circle cx="27" cy="15" r="3" fill="#2D3436"/>
          <circle cx="14" cy="14" r="1" fill="white"/>
          <circle cx="28" cy="14" r="1" fill="white"/>
          <ellipse cx="20" cy="23" rx="5" ry="4" fill="#8B6914"/>
          <ellipse cx="20" cy="22" rx="2.5" ry="2" fill="#2D3436"/>
          <circle cx="9" cy="10" r="5" fill="#B08040"/>
          <circle cx="31" cy="10" r="5" fill="#B08040"/>
        </svg>
        <span>Monet</span>
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

      {/* Update notification */}
      {updateStatus?.status === 'countdown' && (
        <div className="update-banner" style={{ flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <span style={{ fontWeight: 700, fontSize: 12 }}>🎉 Restarting in {updateStatus.seconds}s</span>
            <button onClick={() => bridge?.updater.dismiss()} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.5)', cursor: 'pointer', fontSize: 14 }}>✕</button>
          </div>
          <button onClick={() => bridge?.updater.install()} style={{ background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 700 }}>
            Restart Now
          </button>
        </div>
      )}
      {updateStatus?.status === 'ready' && !updateStatus?.dismissed && (
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
