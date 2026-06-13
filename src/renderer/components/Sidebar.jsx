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
    { id: 'settings', icon: '⚙️', label: 'Settings' },
    { id: 'chat', icon: '💬', label: 'Chat' },
  ];

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
        <span>ASPEN</span>
        <span style={{ fontSize: 9, fontWeight: 600, background: '#ECECEE', color: 'var(--text-2)', padding: '1px 5px', borderRadius: 4, letterSpacing: '.5px', marginLeft: 4 }}>BETA</span>
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

      <div style={{ padding: '6px 14px', fontSize: 10, color: 'var(--t4, #AEAEB2)', letterSpacing: '.02em' }}>v{appVersion}</div>
    </aside>
  );
}
