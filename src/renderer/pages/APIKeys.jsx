import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../App';

export default function APIKeys() {
  const { bridge, gatewayStatus } = useApp();
  const [keys, setKeys] = useState([]);
  const [newLabel, setNewLabel] = useState('');
  const [showSecret, setShowSecret] = useState({});
  const [copied, setCopied] = useState(null);
  const [tunnelStatus, setTunnelStatus] = useState({ connected: false, url: null });

  const loadKeys = useCallback(async () => {
    if (!bridge) return;
    const k = await bridge.apikeys.list();
    setKeys(k);
  }, [bridge]);

  useEffect(() => { loadKeys(); }, [loadKeys]);

  // Fetch tunnel status
  useEffect(() => {
    if (!bridge?.tunnel) return;
    bridge.tunnel.getStatus().then(setTunnelStatus).catch(() => {});
    const unsub = bridge.tunnel.onStatus((data) => {
      setTunnelStatus(data);
    });
    return unsub;
  }, [bridge]);

  async function createKey() {
    if (!bridge) return;
    const label = newLabel.trim() || 'My API Key';
    await bridge.apikeys.create(label);
    setNewLabel('');
    loadKeys();
  }

  async function revokeKey(id) {
    if (!bridge) return;
    if (!confirm('Revoke this key? Apps using it will stop working.')) return;
    await bridge.apikeys.revoke(id);
    loadKeys();
  }

  function copyKey(secret, id) {
    navigator.clipboard.writeText(secret);
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
        Generate keys for your apps.
      </div>

      {/* URL display */}
      <div style={{ marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--text-light)', minWidth: 100 }}>🏠 Same machine:</span>
          <code className="font-mono" style={{ fontSize: 13 }}>{localUrl}</code>
        </div>
        {publicUrl ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: 'var(--text-light)', minWidth: 100 }}>🌍 From anywhere:</span>
            <code className="font-mono" style={{ fontSize: 13 }}>{publicUrl}</code>
            <span style={{ fontSize: 11, color: 'var(--honey)', fontWeight: 600 }}>✓ Connected</span>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: 'var(--text-light)', minWidth: 100 }}>🌍 From anywhere:</span>
            <span style={{ fontSize: 13, color: 'var(--text-light)' }}>Connecting...</span>
          </div>
        )}
      </div>

      {/* Key explanation */}
      <div className="upgrade-banner" style={{ marginBottom: 24 }}>
        <div className="bear">🐻🙈</div>
        <div className="upgrade-banner-text">
          <h4>Keys are 100% local</h4>
          <p>They never leave your machine. They just give your apps something to authenticate with.</p>
        </div>
      </div>

      {/* Create new key */}
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

      {/* Key list */}
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
                >
                  {showSecret[key.id] ? key.secret : key.secret.slice(0, 16) + '••••••••••••'}
                </code>
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => copyKey(key.secret, key.id)}
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
