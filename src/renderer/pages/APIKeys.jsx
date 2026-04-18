import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../App';

export default function APIKeys() {
  const { bridge, gatewayStatus } = useApp();
  const [keys, setKeys] = useState([]);
  const [newLabel, setNewLabel] = useState('');
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
    const created = await bridge.apikeys.create(label);
    setNewLabel('');
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
    navigator.clipboard.writeText(text);
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
        Generate keys so your apps can talk to the bear.
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
        <div className="bear">🐻🙈</div>
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
