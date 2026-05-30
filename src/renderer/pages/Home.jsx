import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../App';

const COST_PER_EXCHANGE = 0.040; // ~Claude Opus 4 API pricing

export default function Home() {
  const { bridge, gatewayStatus, models } = useApp();
  const [keys, setKeys] = useState([]);
  const [tunnelStatus, setTunnelStatus] = useState({ connected: false, url: null });

  // Invite state
  const [showInvite, setShowInvite] = useState(false);
  const [inviteeName, setInviteeName] = useState('');
  const [inviteeEmail, setInviteeEmail] = useState('');
  const [inviteKey, setInviteKey] = useState('');
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteResult, setInviteResult] = useState(null); // 'sent' | 'copied' | 'error'

  const loadData = useCallback(async () => {
    if (!bridge) return;
    const k = await bridge.apikeys.list();
    setKeys(k || []);
  }, [bridge]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (!bridge?.tunnel) return;
    bridge.tunnel.getStatus().then(s => setTunnelStatus(s)).catch(() => {});
    const unsub = bridge.tunnel.onStatus(s => setTunnelStatus(s));
    return unsub;
  }, [bridge]);

  // Preselect first key for invite
  useEffect(() => {
    if (keys.length > 0 && !inviteKey) setInviteKey(keys[0].id);
  }, [keys, inviteKey]);

  const totalExchanges = keys.reduce((sum, k) => sum + (k.usageCount || 0), 0);
  const totalSaved = (totalExchanges * COST_PER_EXCHANGE).toFixed(2);
  const tunnelUrl = tunnelStatus?.url || null;

  function getKeyById(id) { return keys.find(k => k.id === id); }

  async function sendInvite() {
    if (!inviteeEmail) return;
    const key = getKeyById(inviteKey);
    if (!key || !tunnelUrl) return;

    setInviteSending(true);
    setInviteResult(null);
    try {
      const res = await fetch('https://runonaspen.com/api/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inviteeName,
          inviteeEmail,
          tunnelUrl,
          apiKey: key.secret,
          inviterName: 'Mayank', // TODO: pull from store/settings
        }),
      });
      if (!res.ok) throw new Error('Send failed');
      setInviteResult('sent');
      setInviteeName('');
      setInviteeEmail('');
    } catch {
      setInviteResult('error');
    }
    setInviteSending(false);
  }

  function copyMagicLink() {
    const key = getKeyById(inviteKey);
    if (!key || !tunnelUrl) return;
    const base = tunnelUrl.replace(/\/v1\/?$/, '');
    const params = new URLSearchParams({ tunnel: base, key: key.secret });
    const link = `https://runonaspen.com/app#${params.toString()}`;
    if (bridge?.clipboard?.write) {
      bridge.clipboard.write(link);
    } else {
      navigator.clipboard.writeText(link).catch(() => {});
    }
    setInviteResult('copied');
    setTimeout(() => setInviteResult(null), 2500);
  }

  const s = { // styles
    label: { fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-light)', marginBottom: 6, display: 'block' },
    input: { width: '100%', padding: '9px 12px', borderRadius: 8, border: '1.5px solid rgba(93,78,55,0.15)', fontFamily: 'inherit', fontSize: 14, color: 'var(--text-dark)', background: 'var(--sky-top)', outline: 'none' },
    row: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid rgba(93,78,55,0.08)' },
  };

  return (
    <div className="page" style={{ maxWidth: 680 }}>

      {/* ── SAVINGS HERO ── */}
      <div className="card mb-6" style={{
        background: 'linear-gradient(135deg, rgba(184,134,11,0.08) 0%, rgba(93,78,55,0.04) 100%)',
        border: '1.5px solid rgba(184,134,11,0.15)',
        padding: '28px 32px',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 20 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--gold)', letterSpacing: '.05em', marginBottom: 6 }}>TOTAL SAVED VS CLOUD AI</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 48, fontWeight: 700, color: 'var(--earth)', lineHeight: 1 }}>
              ${totalSaved}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-light)', marginTop: 8 }}>
              {totalExchanges.toLocaleString()} exchanges · vs Claude Opus 4 API pricing
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 160 }}>
            <StatPill label="Models installed" value={models.length} />
            <StatPill label="Gateway" value={gatewayStatus.running ? `Port ${gatewayStatus.port}` : 'Offline'} ok={gatewayStatus.running} />
            <StatPill label="Tunnel" value={tunnelStatus.connected ? 'Connected' : 'Connecting…'} ok={tunnelStatus.connected} />
          </div>
        </div>
      </div>

      {/* ── PER-KEY USAGE ── */}
      <div className="card mb-6">
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, color: 'var(--earth)', marginBottom: 4 }}>
          🔑 API Key Usage
        </h3>
        <p style={{ fontSize: 13, color: 'var(--text-light)', marginBottom: 16, lineHeight: 1.5 }}>
          Each key tracks how often it's been used. Revoke any key from API Keys.
        </p>

        {keys.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-light)' }}>No keys yet.</p>
        ) : (
          <div>
            {/* Header */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 120px', gap: 8, padding: '6px 0', borderBottom: '2px solid rgba(93,78,55,0.1)', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-light)' }}>
              <span>Key</span>
              <span style={{ textAlign: 'right' }}>Uses</span>
              <span style={{ textAlign: 'right' }}>Saved</span>
              <span style={{ textAlign: 'right' }}>Last used</span>
            </div>
            {keys.map(key => {
              const uses = key.usageCount || 0;
              const saved = (uses * COST_PER_EXCHANGE).toFixed(2);
              const lastUsed = key.lastUsed ? new Date(key.lastUsed).toLocaleDateString() : 'Never';
              return (
                <div key={key.id} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 120px', gap: 8, padding: '10px 0', borderBottom: '1px solid rgba(93,78,55,0.06)', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-dark)' }}>{key.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-light)', fontFamily: 'var(--font-mono)' }}>
                      {key.secret.slice(0, 16)}••••
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: 14, fontWeight: 600, color: 'var(--earth)' }}>{uses.toLocaleString()}</div>
                  <div style={{ textAlign: 'right', fontSize: 13, color: 'var(--gold)' }}>${saved}</div>
                  <div style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-light)' }}>{lastUsed}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── INVITE ── */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: showInvite ? 16 : 0 }}>
          <div>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, color: 'var(--earth)', marginBottom: 2 }}>
              👥 Invite Family & Friends
            </h3>
            <p style={{ fontSize: 13, color: 'var(--text-light)', margin: 0, lineHeight: 1.5 }}>
              Give someone access to your Aspen. They get their own key and a magic link.
            </p>
          </div>
          <button
            className="btn btn-sm"
            onClick={() => { setShowInvite(!showInvite); setInviteResult(null); }}
            style={{ flexShrink: 0 }}
          >
            {showInvite ? 'Cancel' : '+ Invite'}
          </button>
        </div>

        {showInvite && (
          <div style={{ borderTop: '1px solid rgba(93,78,55,0.1)', paddingTop: 16 }}>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={s.label}>Their name (optional)</label>
                <input
                  style={s.input}
                  placeholder="Ashini"
                  value={inviteeName}
                  onChange={e => setInviteeName(e.target.value)}
                />
              </div>
              <div>
                <label style={s.label}>Their email *</label>
                <input
                  style={s.input}
                  type="email"
                  placeholder="ashini@example.com"
                  value={inviteeEmail}
                  onChange={e => setInviteeEmail(e.target.value)}
                />
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={s.label}>API Key to give them</label>
              <select
                style={{ ...s.input, cursor: 'pointer' }}
                value={inviteKey}
                onChange={e => setInviteKey(e.target.value)}
              >
                {keys.map(k => (
                  <option key={k.id} value={k.id}>{k.label} ({k.secret.slice(0, 14)}••••)</option>
                ))}
              </select>
              <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 4 }}>
                Create a dedicated key in API Keys for each person so you can revoke individually.
              </div>
            </div>

            {!tunnelUrl && (
              <div style={{ padding: '10px 14px', background: 'rgba(231,76,60,0.06)', border: '1px solid rgba(231,76,60,0.15)', borderRadius: 8, fontSize: 13, color: 'var(--danger)', marginBottom: 12 }}>
                Tunnel not connected — can't generate invite link yet. Check your internet connection.
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                className="btn"
                onClick={sendInvite}
                disabled={!inviteeEmail || !tunnelUrl || inviteSending}
                style={{ background: 'var(--earth)', color: '#fff' }}
              >
                {inviteSending ? 'Sending…' : '✉️ Send invite email'}
              </button>
              <button
                className="btn btn-sm"
                onClick={copyMagicLink}
                disabled={!tunnelUrl}
              >
                {inviteResult === 'copied' ? '✓ Link copied!' : '🔗 Copy magic link'}
              </button>
            </div>

            {inviteResult === 'sent' && (
              <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--green-soft)', borderRadius: 8, fontSize: 13, color: 'var(--green)' }}>
                ✓ Invite sent to {inviteeEmail}! They'll get a magic link that opens straight into your Aspen.
              </div>
            )}
            {inviteResult === 'error' && (
              <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(231,76,60,0.06)', borderRadius: 8, fontSize: 13, color: 'var(--danger)' }}>
                Failed to send. Copy the magic link instead and share it yourself.
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
}

function StatPill({ label, value, ok }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.6)', borderRadius: 8, padding: '7px 12px', fontSize: 12 }}>
      <span style={{ color: 'var(--text-light)' }}>{label}</span>
      <span style={{ fontWeight: 600, color: ok === undefined ? 'var(--earth)' : ok ? 'var(--green)' : 'var(--danger)' }}>{value}</span>
    </div>
  );
}
