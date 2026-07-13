import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../App';

export default function Sidebar() {
  const { page, setPage, ollamaStatus, activeModel, gatewayStatus, bridge,
    conversations, activeConvo, setActiveConvo, setConversations, newConvo, deleteConvo,
    missions, viewingMissionId, setViewingMissionId } = useApp();
  const [updateStatus, setUpdateStatus] = useState(null);
  const [installMsg, setInstallMsg] = useState('');
  const [appVersion, setAppVersion] = useState('...');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingTitle, setEditingTitle] = useState(null);
  const [streak, setStreak] = useState(null);
  const [checkMsg, setCheckMsg] = useState('');
  const updateStatusRef = useRef(null);
  updateStatusRef.current = updateStatus;

  async function handleCheckUpdates() {
    if (checkMsg === 'Checking…') return;
    setCheckMsg('Checking…');
    try { await bridge.updater.check(); } catch {}
    setTimeout(() => {
      const s = updateStatusRef.current?.status;
      if (s === 'ready' || s === 'downloading') { setCheckMsg(''); } // the update banner shows it
      else { setCheckMsg("You're on the latest version ✓"); setTimeout(() => setCheckMsg(''), 3500); }
    }, 3500);
  }

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

      {(() => {
        const shown = [...missions.filter((m) => m.status === 'active'), ...missions.filter((m) => m.status !== 'active').slice(-3)];
        if (!shown.length) return null;
        const dotColor = { active: '#22c55e', done: '#9A9AA0', blocked: '#ef4444', stopped: '#AEAEB2' };
        const statusWord = { active: 'working', done: 'done', blocked: 'blocked', stopped: 'stopped' };
        return (
          <div className="sidebar-chats" style={{ paddingBottom: 4 }}>
            <div className="sidebar-chats-head"><span className="sidebar-chats-title">⚡ Missions</span></div>
            <div>
              {shown.map((m) => (
                <div
                  key={m.id}
                  onClick={() => { setViewingMissionId(m.id); setPage('chat'); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 8, cursor: 'pointer', fontSize: 13, background: viewingMissionId === m.id ? 'rgba(0,0,0,.06)' : 'transparent' }}
                  onMouseEnter={(e) => { if (viewingMissionId !== m.id) e.currentTarget.style.background = 'rgba(0,0,0,.04)'; }}
                  onMouseLeave={(e) => { if (viewingMissionId !== m.id) e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor[m.status] || '#9A9AA0', flexShrink: 0 }} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.goal}>{m.goal}</span>
                  <span style={{ fontSize: 10.5, color: 'var(--text-light, #9A9AA0)', textTransform: 'lowercase' }}>{statusWord[m.status] || ''}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      <div className="sidebar-chats">
        <div className="sidebar-chats-head">
          <span className="sidebar-chats-title">Chats</span>
          <button className="sidebar-newchat" onClick={() => { setViewingMissionId(null); newConvo(); }} title="New chat">+</button>
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
                onClick={() => { setViewingMissionId(null); setActiveConvo(c.id); setPage('chat'); }}
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

      <button
        onClick={handleCheckUpdates}
        title="Check for updates now"
        style={{ display: 'block', width: 'calc(100% - 28px)', margin: '2px 14px 2px', padding: '4px 0', background: 'none', border: 'none', color: 'var(--text-light,#8A8A8E)', fontSize: 11, cursor: 'pointer', textAlign: 'left' }}
      >
        {checkMsg || '↻ Check for updates'}
      </button>

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
