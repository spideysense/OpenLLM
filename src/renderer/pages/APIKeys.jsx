import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../App';

export default function APIKeys() {
  const { bridge, gatewayStatus } = useApp();
  const [keys, setKeys] = useState([]);
  const [newLabel, setNewLabel] = useState('');
  const [newKeyType, setNewKeyType] = useState('guest');
  const [showSecret, setShowSecret] = useState({});
  const [copied, setCopied] = useState(null);
  const [tunnelStatus, setTunnelStatus] = useState({ connected: false, url: null });
  const [newlyCreatedKey, setNewlyCreatedKey] = useState(null);

  const loadKeys = useCallback(async () => {
    if (!bridge) return;
    const k = await bridge.apikeys.list();
    setKeys(k);
  }, [bridge]);

  useEffect(() => { loadKeys(); }, [loadKeys]);

  // Fetch tunnel status
  useEffect(() => {
    if (!bridge?.tunnel) return;
    bridge.tunnel.getStatus().then((s) => setTunnelStatus({
      connected: s.connected,
      url: s.url,
      status: s.connected ? 'connected' : 'connecting',
    })).catch(() => {});
    const unsub = bridge.tunnel.onStatus((data) => {
      setTunnelStatus(data);
    });
    return unsub;
  }, [bridge]);

  async function createKey() {
    if (!bridge) return;
    const label = newLabel.trim() || 'My API Key';
    const created = await bridge.apikeys.create(label, {
      owner: newKeyType === 'owner',
      memory: newKeyType === 'named',
    });
    setNewLabel('');
    setNewKeyType('guest');
    setNewlyCreatedKey(created);   // ← show the full secret immediately
    loadKeys();
  }

  async function revokeKey(id) {
    if (!bridge) return;
    if (!confirm('Revoke this key? Apps using it will stop working.')) return;
    if (newlyCreatedKey?.id === id) setNewlyCreatedKey(null);
    await bridge.apikeys.revoke(id);
    loadKeys();
  }

  function copy(text, id) {
    if (bridge?.clipboard?.write) {
      bridge.clipboard.write(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  const port = gatewayStatus?.port || 4000;
  const localUrl = `http://localhost:${port}/v1`;
  const publicUrl = tunnelStatus?.connected && tunnelStatus?.url ? `${tunnelStatus.url}/v1` : null;

  return (
    <div className="page">
      <div className="page-title">🔑 API Keys</div>
      <div className="page-sub">
        Generate keys so your apps can talk to Aspen.
      </div>

      {/* ── URL display ── */}
      <div style={{ marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--text-light)', minWidth: 110 }}>🏠 Same machine:</span>
          <code className="font-mono" style={{ fontSize: 13, flex: 1 }}>{localUrl}</code>
          <button
            className="btn btn-sm btn-secondary"
            onClick={() => copy(localUrl, 'localUrl')}
            style={{ flexShrink: 0 }}
          >
            {copied === 'localUrl' ? '✓ Copied' : 'Copy'}
          </button>
        </div>
        {publicUrl ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: 'var(--text-light)', minWidth: 110 }}>🌍 From anywhere:</span>
            <code className="font-mono" style={{ fontSize: 13, flex: 1 }}>{publicUrl}</code>
            <button
              className="btn btn-sm btn-secondary"
              onClick={() => copy(publicUrl, 'publicUrl')}
              style={{ flexShrink: 0 }}
            >
              {copied === 'publicUrl' ? '✓ Copied' : 'Copy'}
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: 'var(--text-light)', minWidth: 110 }}>🌍 From anywhere:</span>
            <span style={{ fontSize: 13, color: 'var(--text-light)', fontStyle: 'italic' }}>
              {tunnelStatus.status === 'downloading' && '⬇️ Downloading Cloudflare tunnel...'}
              {tunnelStatus.status === 'connecting' && '🔌 Connecting...'}
              {tunnelStatus.status === 'reconnecting' && '🔄 Reconnecting...'}
              {tunnelStatus.status === 'error' && '⚠️ Tunnel error — will retry'}
              {(!tunnelStatus.status || tunnelStatus.status === 'disconnected') && '🔌 Connecting...'}
            </span>
          </div>
        )}
      </div>

      {/* ── Newly created key banner ── */}
      {newlyCreatedKey && (
        <div className="card" style={{
          marginBottom: 24,
          background: 'linear-gradient(135deg, rgba(123,198,126,0.12) 0%, rgba(74,166,81,0.06) 100%)',
          border: '1.5px solid rgba(74,166,81,0.3)',
          padding: 20,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--earth)', fontSize: 15 }}>
                🎉 Key created: {newlyCreatedKey.label}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-light)', marginLeft: 10 }}>
                Copy it now — for security, it won't be shown in full again.
              </span>
            </div>
            <button
              className="btn btn-sm"
              style={{ background: 'transparent', color: 'var(--text-light)', border: 'none', cursor: 'pointer' }}
              onClick={() => setNewlyCreatedKey(null)}
            >
              ✕
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <code style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              padding: '10px 14px',
              background: 'var(--cloud)',
              borderRadius: 'var(--radius-sm)',
              flex: 1,
              wordBreak: 'break-all',
              color: 'var(--earth)',
              border: '1.5px solid rgba(74,166,81,0.3)',
            }}>
              {newlyCreatedKey.secret}
            </code>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => copy(newlyCreatedKey.secret, 'newKey')}
              style={{ flexShrink: 0 }}
            >
              {copied === 'newKey' ? '✓ Copied!' : 'Copy Key'}
            </button>
          </div>
        </div>
      )}

      {/* ── Key explanation ── */}
      <div className="upgrade-banner" style={{ marginBottom: 24 }}>
        <div className="aspen">🌿</div>
        <div className="upgrade-banner-text">
          <h4>Keys are 100% local</h4>
          <p>They never leave your machine. They just give your apps something to authenticate with.</p>
        </div>
      </div>

      {/* ── Create new key ── */}
      <div className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--earth)', marginBottom: 12 }}>
          Create New Key
        </h3>
        <div className="flex gap-3">
          <input
            className="input"
            placeholder="Key label (e.g., 'My Python App')"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createKey()}
            style={{ maxWidth: 300 }}
          />
          <button className="btn btn-primary btn-sm" onClick={createKey}>
            Generate Key
          </button>
        </div>

        {/* ── Owner vs Guest selection ── */}
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', padding: '10px 14px', borderRadius: 8, border: `1.5px solid ${newKeyType === 'owner' ? 'var(--pipe-yellow)' : 'rgba(0,0,0,0.15)'}`, background: newKeyType === 'owner' ? 'rgba(212,160,23,0.06)' : 'transparent' }}>
            <input type="radio" name="keyType" checked={newKeyType === 'owner'} onChange={() => setNewKeyType('owner')} style={{ marginTop: 3 }} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--earth)' }}>👑 Owner key</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-light)', lineHeight: 1.5, marginTop: 2 }}>
                Full access: computer use (screen control), shared memory (your World Model), and all tools.
                Only give this to devices that are <strong>you</strong> — anyone with it can control your machine.
              </div>
            </div>
          </label>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', padding: '10px 14px', borderRadius: 8, border: `1.5px solid ${newKeyType === 'named' ? 'var(--pipe-yellow)' : 'rgba(0,0,0,0.15)'}`, background: newKeyType === 'named' ? 'rgba(212,160,23,0.06)' : 'transparent' }}>
            <input type="radio" name="keyType" checked={newKeyType === 'named'} onChange={() => setNewKeyType('named')} style={{ marginTop: 3 }} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--earth)' }}>🧑‍🤝‍🧑 Family / member key</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-light)', lineHeight: 1.5, marginTop: 2 }}>
                For a specific person (e.g. Ashini, Anjali). Gets their <strong>own private memory</strong> that
                follows them across their devices — chat + safe tools. No computer use, can't see your memory.
                Use the label field above for their name.
              </div>
            </div>
          </label>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', padding: '10px 14px', borderRadius: 8, border: `1.5px solid ${newKeyType === 'guest' ? 'var(--pipe-yellow)' : 'rgba(0,0,0,0.15)'}`, background: newKeyType === 'guest' ? 'rgba(212,160,23,0.06)' : 'transparent' }}>
            <input type="radio" name="keyType" checked={newKeyType === 'guest'} onChange={() => setNewKeyType('guest')} style={{ marginTop: 3 }} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--earth)' }}>👤 Anonymous guest key</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-light)', lineHeight: 1.5, marginTop: 2 }}>
                Reasoning engine only: chat and safe tools (web search, calculator).
                No memory, no computer use. Ephemeral — safe to share widely.
              </div>
            </div>
          </label>
        </div>
      </div>

      {/* ── Key list ── */}
      {keys.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: 48,
          color: 'var(--text-light)',
          fontSize: 14,
        }}>
          <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.5 }}>🔑</div>
          <p>No API keys yet. The gateway is running in <strong>open mode</strong> — any key is accepted.</p>
          <p style={{ marginTop: 8 }}>Generate a key above to enable authentication.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {keys.map((key) => (
            <div key={key.id} className="card" style={{ padding: 16 }}>
              <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                <div>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--earth)' }}>
                    {key.label}
                  </span>
                  <span style={{
                    fontSize: 11, fontWeight: 600, marginLeft: 10, padding: '2px 8px', borderRadius: 10,
                    background: key.owner ? 'rgba(212,160,23,0.15)' : (key.memory ? 'rgba(90,140,90,0.15)' : 'rgba(0,0,0,0.1)'),
                    color: key.owner ? '#9a7d0a' : (key.memory ? '#3c6b3c' : 'var(--text-light)'),
                  }}>
                    {key.owner ? '👑 Owner' : (key.memory ? '🧑‍🤝‍🧑 Member' : '👤 Guest')}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-light)', marginLeft: 12 }}>
                    Created {new Date(key.created).toLocaleDateString()}
                  </span>
                </div>
                <button className="btn btn-sm btn-danger" onClick={() => revokeKey(key.id)}>
                  Revoke
                </button>
              </div>

              <div className="flex items-center gap-2">
                <code
                  className="input-mono input"
                  style={{
                    padding: '8px 12px',
                    fontSize: 12,
                    flex: 1,
                    cursor: 'pointer',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  onClick={() => setShowSecret((prev) => ({ ...prev, [key.id]: !prev[key.id] }))}
                  title="Click to reveal"
                >
                  {showSecret[key.id] ? key.secret : key.secret.slice(0, 16) + '••••••••••••'}
                </code>
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => setShowSecret((prev) => ({ ...prev, [key.id]: !prev[key.id] }))}
                  style={{ flexShrink: 0 }}
                >
                  {showSecret[key.id] ? 'Hide' : 'Reveal'}
                </button>
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => copy(key.secret, key.id)}
                  style={{ flexShrink: 0 }}
                >
                  {copied === key.id ? '✓ Copied' : 'Copy'}
                </button>
              </div>

              {key.lastUsed && (
                <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 6 }}>
                  Last used: {new Date(key.lastUsed).toLocaleString()}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
