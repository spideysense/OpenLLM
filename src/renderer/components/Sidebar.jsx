import React from 'react';
import { useApp } from '../App';

export default function Sidebar() {
  const { page, setPage, ollamaStatus, activeModel, gatewayStatus } = useApp();

  const nav = [
    { id: 'chat', icon: '💬', label: 'Chat' },
    { id: 'models', icon: '🐻', label: 'Models' },
    { id: 'replace', icon: '🔌', label: 'Replace AI' },
    { id: 'apikeys', icon: '🔑', label: 'API Keys' },
    { id: 'settings', icon: '⚙️', label: 'Settings' },
  ];

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
        <span>LLM Bear</span>
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
