import React, { useState, useEffect } from 'react';
import { useApp } from '../App';

export default function Sidebar() {
  const { page, setPage, ollamaStatus, activeModel, gatewayStatus, bridge,
    conversations, activeConvo, setActiveConvo, setConversations, newConvo, deleteConvo } = useApp();
  const [updateStatus, setUpdateStatus] = useState(null);
  const [installMsg, setInstallMsg] = useState('');
  const [appVersion, setAppVersion] = useState('...');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingTitle, setEditingTitle] = useState(null);
  const [streak, setStreak] = useState(null);

  useEffect(() => {
    // Local-only usage counter written by the main process on launch. Read via
    // the existing store bridge; nothing is transmitted anywhere.
    if (bridge?.store?.get) {
      bridge.store.get('privacyStreak').then((s) => s && setStreak(s)).catch(() => {});
    }
  }, [bridge]);

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
    { id: 'home', label: 'Home' },
    { id: 'settings', label: 'Settings' },
    { id: 'chat', label: 'Chat' },
  ];

  const ICONS = {
    home: (
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20h14V9.5" />
      </svg>
    ),
    settings: (
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
    chat: (
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z" />
      </svg>
    ),
  };

  async function handleInstallUpdate() {
    // Two update systems share this banner. A renderer hot-update (source:'hot')
    // is applied by reloading; a full-app update (source:'app') needs
    // quitAndInstall. Dispatch by source, and ALWAYS leave the user with a
    // working action — if in-place install isn't possible, open the download page.
    if (updateStatus?.source === 'hot') {
      if (bridge?.hotUpdater) { setInstallMsg('Reloading…'); await bridge.hotUpdater.reload(); }
      return;
    }
    if (!bridge?.updater) return;
    setInstallMsg('Updating…');
    let res;
    try { res = await bridge.updater.install(); } catch { res = { ok: false }; }
    if (!res || res.ok === false) {
      // Nothing staged to install (or an old/unsigned running build can't
      // self-update). Send them to the latest release so the click is never dead.
      setInstallMsg('Opening download page…');
      try { await bridge.updater.openReleases(); } catch {}
      setTimeout(() => setInstallMsg(''), 4000);
    }
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <svg className="sidebar-logo-mark" viewBox="0 0 32 32" width="20" height="20" aria-hidden="true">
          <g transform="translate(4,1) scale(0.75)" fill="none" stroke="currentColor" strokeLinecap="round">
            <path d="M16 38L16 22" strokeWidth="1.8" />
            <path d="M16 2C16 2,3 9,3 20C3 28,8.5 33,16 33C23.5 33,29 28,29 20C29 9,16 2,16 2Z" strokeWidth="1.6" />
            <path d="M16 7L16 30" strokeWidth="0.9" />
            <path d="M16 14C12.5 17,8 18,6 19" strokeWidth="0.8" />
            <path d="M16 14C19.5 17,24 18,26 19" strokeWidth="0.8" />
            <path d="M16 21C12.5 24,9 25,7 26" strokeWidth="0.8" />
            <path d="M16 21C19.5 24,23 25,25 26" strokeWidth="0.8" />
          </g>
        </svg>
        <span>ASPEN</span>
        <span style={{ fontSize: 9, fontWeight: 600, background: '#ECECEE', color: 'var(--text-2)', padding: '1px 5px', borderRadius: 4, letterSpacing: '.5px', marginLeft: 4 }}>BETA</span>
      </div>

      {nav.map((item) => (
        <button
          key={item.id}
          className={`nav-item ${page === item.id ? 'active' : ''}`}
          onClick={() => setPage(item.id)}
        >
          <span className="nav-icon">{ICONS[item.id]}</span>
          {item.label}
        </button>
      ))}

      <div className="sidebar-chats">
        <div className="sidebar-chats-head">
          <span className="sidebar-chats-title">Chats</span>
          <button className="sidebar-newchat" onClick={newConvo} title="New chat">+</button>
        </div>
        <input
          className="sidebar-search"
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search chats..."
        />
        <div className="sidebar-chats-list">
          {[...(conversations || [])].reverse()
            .filter((c) => !searchQuery
              || c.title?.toLowerCase().includes(searchQuery.toLowerCase())
              || c.messages?.some((m) => m.content?.toLowerCase().includes(searchQuery.toLowerCase())))
            .map((c) => (
              <div
                key={c.id}
                className={`chat-item ${c.id === activeConvo ? 'active' : ''}`}
                onClick={() => { setActiveConvo(c.id); setPage('chat'); }}
              >
                {editingTitle === c.id ? (
                  <input
                    autoFocus
                    className="chat-item-rename"
                    value={c.title || ''}
                    onChange={(e) => setConversations((cs) => cs.map((x) => x.id === c.id ? { ...x, title: e.target.value } : x))}
                    onBlur={() => setEditingTitle(null)}
                    onKeyDown={(e) => { if (e.key === 'Enter') setEditingTitle(null); }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span
                    className="chat-item-title"
                    title="Double-click to rename"
                    onDoubleClick={(e) => { e.stopPropagation(); setEditingTitle(c.id); }}
                  >
                    {c.title || 'New Chat'}
                  </span>
                )}
                {conversations.length > 1 && (
                  <button
                    className="chat-item-del"
                    onClick={(e) => { e.stopPropagation(); deleteConvo(c.id); }}
                  >✕</button>
                )}
              </div>
            ))}
        </div>
      </div>

      {/* Update notification — quiet, no countdowns */}
      {updateStatus?.status === 'ready' && (
        <button onClick={handleInstallUpdate} className="update-banner">
          <span>🎉</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 12 }}>Update ready</div>
            <div style={{ fontSize: 11, opacity: 0.8 }}>{installMsg || (updateStatus.source === 'hot' ? `v${updateStatus.version} — click to reload` : `v${updateStatus.version} — click to restart & update`)}</div>
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
        }}>
          <div className="truncate" title={activeModel}>{activeModel}</div>
        </div>
      )}

      <div style={{ padding: '6px 14px', fontSize: 10, color: 'var(--t4, #AEAEB2)', letterSpacing: '.02em' }}>
        v{appVersion}
        {streak?.totalDays >= 2 && (
          <span title={streak.streak >= 2 ? `${streak.streak}-day streak` : undefined}>
            {' · '}{streak.totalDays} days private — nothing ever left this machine
          </span>
        )}
      </div>
    </aside>
  );
}
