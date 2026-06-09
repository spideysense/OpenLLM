import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../App';

// Opus 4.6 pricing: $5/1M input, $25/1M output
// Avg exchange: ~800 input tokens + ~600 output tokens
// Cost: (800*5 + 600*25) / 1,000,000 = $0.019 ≈ $0.02
const COST_PER_EXCHANGE = 0.019;
const MODEL_LABEL = 'Claude Opus 4.6 API';

export default function Home() {
  const { bridge, gatewayStatus, models, setPage } = useApp();
  const [keys, setKeys] = useState([]);
  const [tunnelStatus, setTunnelStatus] = useState({ connected: false, url: null });
  const [showInvite, setShowInvite] = useState(false);
  const [inviteeName, setInviteeName] = useState('');
  const [inviteeEmail, setInviteeEmail] = useState('');
  const [inviteKey, setInviteKey] = useState('');
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteResult, setInviteResult] = useState(null);
  const [copied, setCopied] = useState(null);

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
  useEffect(() => { if (keys.length > 0 && !inviteKey) setInviteKey(keys[0].id); }, [keys, inviteKey]);

  const totalExchanges = keys.reduce((sum, k) => sum + (k.usageCount || 0), 0);
  const totalSaved = (totalExchanges * COST_PER_EXCHANGE).toFixed(2);
  const tunnelUrl = tunnelStatus?.url || null;

  const [shared, setShared] = useState(false);
  const [sharing, setSharing] = useState(false);

  async function shareSavings() {
    if (shared || sharing || totalExchanges < 1) return;
    setSharing(true);
    try {
      await fetch('https://runonaspen.com/api/community-savings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exchanges: totalExchanges, saved: parseFloat(totalSaved) }),
      });
      setShared(true);
    } catch {}
    setSharing(false);
  }
    if (bridge?.clipboard?.write) bridge.clipboard.write(text);
    else navigator.clipboard.writeText(text).catch(() => {});
    setCopied(id); setTimeout(() => setCopied(null), 2000);
  }

  function getMagicLink() {
    const key = keys.find(k => k.id === inviteKey);
    if (!key || !tunnelUrl) return 'https://runonaspen.com/app';
    const base = tunnelUrl.replace(/\/v1$/, '');
    const params = new URLSearchParams({ tunnel: base, key: key.secret });
    return `https://runonaspen.com/app#${params.toString()}`;
  }

  async function sendInvite() {
    const key = keys.find(k => k.id === inviteKey);
    if (!inviteeEmail || !key || !tunnelUrl) return;
    setInviteSending(true); setInviteResult(null);
    try {
      const res = await fetch('https://runonaspen.com/api/invite', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteeName, inviteeEmail, tunnelUrl, apiKey: key.secret, inviterName: 'Mayank' }),
      });
      if (!res.ok) throw new Error();
      setInviteResult('sent'); setInviteeName(''); setInviteeEmail('');
    } catch { setInviteResult('error'); }
    setInviteSending(false);
  }

  const inp = { width: '100%', padding: '9px 12px', borderRadius: 8, border: '1.5px solid rgba(93,78,55,0.15)', fontFamily: 'inherit', fontSize: 14, color: 'var(--text-dark)', background: 'var(--sky-top)', outline: 'none' };

  return (
    <div className="page" style={{ maxWidth: 680 }}>
      {/* Savings hero */}
      <div className="card mb-6" style={{ background: 'linear-gradient(135deg,rgba(184,134,11,0.08),rgba(93,78,55,0.04))', border: '1.5px solid rgba(184,134,11,0.15)', padding: '28px 32px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 20 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--gold)', letterSpacing: '.05em', marginBottom: 6 }}>TOTAL SAVED VS CLOUD AI</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 48, fontWeight: 700, color: 'var(--earth)', lineHeight: 1 }}>${totalSaved}</div>
            <div style={{ fontSize: 13, color: 'var(--text-light)', marginTop: 8 }}>{totalExchanges.toLocaleString()} exchanges · vs {MODEL_LABEL}</div>
            <button onClick={shareSavings} disabled={sharing || shared || totalExchanges < 1} style={{ marginTop: 12, padding: '6px 14px', background: shared ? 'var(--sage,#7a9e7e)' : 'var(--gold,#b8860b)', color: '#fff', border: 'none', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: totalExchanges < 1 ? 'default' : 'pointer', opacity: totalExchanges < 1 ? 0.4 : 1 }}>
              {shared ? '✓ Shared with community' : sharing ? 'Sharing…' : '🌿 Share with Aspen Community'}
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 160 }}>
            {[['Models installed', models.length, undefined], ['Gateway', gatewayStatus.running ? `Port ${gatewayStatus.port}` : 'Offline', gatewayStatus.running], ['Tunnel', tunnelStatus.connected ? 'Connected' : 'Connecting…', tunnelStatus.connected]].map(([label, value, ok]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.6)', borderRadius: 8, padding: '7px 12px', fontSize: 12 }}>
                <span style={{ color: 'var(--text-light)' }}>{label}</span>
                <span style={{ fontWeight: 600, color: ok === undefined ? 'var(--earth)' : ok ? 'var(--green)' : 'var(--danger)' }}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Wow demos — show what Aspen can do */}
      <div className="card mb-6" style={{ padding: '20px 24px' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--earth)', fontFamily: 'var(--font-display)', marginBottom: 12 }}>✨ See what Aspen can do</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[
            { emoji: '🎮', title: 'Build a game', prompt: 'Build me a beautiful, playable font guessing game using Google Fonts. Include score tracking, multiple choice answers, a give up button, and smooth animations. Make it visually stunning.' },
            { emoji: '🌐', title: 'Generate a website', prompt: 'Create a stunning, modern landing page for a fictional AI startup called "NovaMind" — include a hero section, features grid, testimonials, and a CTA. Use beautiful gradients and animations.' },
            { emoji: '🔍', title: 'Research anything', prompt: 'Do deep research on the current state of local AI models in 2026 — what are the best open-weight models, how do they compare to cloud models, and what is the future direction? Include sources.' },
            { emoji: '📊', title: 'Visualize data', prompt: 'Create an interactive dashboard that shows fictional sales data for a company across 4 quarters. Include bar charts, line graphs, and summary cards. Make it colorful and responsive.' },
          ].map((demo, i) => (
            <button key={i} onClick={() => {
              if (bridge?.store) bridge.store.set('pendingPrompt', demo.prompt);
              setPage('chat');
            }} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', border: '1.5px solid rgba(93,78,55,.1)', borderRadius: 10, background: 'var(--cloud)', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--text-dark)', textAlign: 'left' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--gold)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(93,78,55,.1)'; }}
            >
              <span style={{ fontSize: 22 }}>{demo.emoji}</span>
              <span>{demo.title}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Per-key usage */}
      <div className="card mb-6">
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, color: 'var(--earth)', marginBottom: 4 }}>🔑 API Key Usage</h3>
        <p style={{ fontSize: 13, color: 'var(--text-light)', marginBottom: 16, lineHeight: 1.5 }}>Each key tracks how often it's been used. Revoke any key from API Keys.</p>
        {keys.length === 0 ? <p style={{ fontSize: 13, color: 'var(--text-light)' }}>No keys yet.</p> : (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 120px', gap: 8, padding: '6px 0', borderBottom: '2px solid rgba(93,78,55,0.1)', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-light)' }}>
              <span>Key</span><span style={{ textAlign: 'right' }}>Uses</span><span style={{ textAlign: 'right' }}>Saved</span><span style={{ textAlign: 'right' }}>Last used</span>
            </div>
            {keys.map(key => (
              <div key={key.id} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 120px', gap: 8, padding: '10px 0', borderBottom: '1px solid rgba(93,78,55,0.06)', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-dark)' }}>{key.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-light)', fontFamily: 'var(--font-mono)' }}>{key.secret.slice(0, 16)}••••</div>
                </div>
                <div style={{ textAlign: 'right', fontSize: 14, fontWeight: 600, color: 'var(--earth)' }}>{(key.usageCount||0).toLocaleString()}</div>
                <div style={{ textAlign: 'right', fontSize: 13, color: 'var(--gold)' }}>${((key.usageCount||0)*COST_PER_EXCHANGE).toFixed(2)}</div>
                <div style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-light)' }}>{key.lastUsed ? new Date(key.lastUsed).toLocaleDateString() : 'Never'}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Invite */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: showInvite ? 16 : 0 }}>
          <div>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, color: 'var(--earth)', marginBottom: 2 }}>👥 Invite Family & Friends</h3>
            <p style={{ fontSize: 13, color: 'var(--text-light)', margin: 0 }}>Give someone access to your Aspen. They get their own key and a magic link.</p>
          </div>
          <button className="btn btn-sm" onClick={() => { setShowInvite(!showInvite); setInviteResult(null); }}>{showInvite ? 'Cancel' : '+ Invite'}</button>
        </div>
        {showInvite && (
          <div style={{ borderTop: '1px solid rgba(93,78,55,0.1)', paddingTop: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div><label style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--t4)', marginBottom: 4, display: 'block' }}>Their name</label><input style={inp} placeholder="Ashini" value={inviteeName} onChange={e=>setInviteeName(e.target.value)} /></div>
              <div><label style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--t4)', marginBottom: 4, display: 'block' }}>Their email *</label><input style={inp} type="email" placeholder="ashini@example.com" value={inviteeEmail} onChange={e=>setInviteeEmail(e.target.value)} /></div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--t4)', marginBottom: 4, display: 'block' }}>API Key to give them</label>
              <select style={{ ...inp, cursor: 'pointer' }} value={inviteKey} onChange={e=>setInviteKey(e.target.value)}>{keys.map(k=><option key={k.id} value={k.id}>{k.label} ({k.secret.slice(0,14)}••••)</option>)}</select>
            </div>
            {!tunnelUrl && <div style={{ padding: '10px 14px', background: 'rgba(231,76,60,0.06)', border: '1px solid rgba(231,76,60,0.15)', borderRadius: 8, fontSize: 13, color: 'var(--danger)', marginBottom: 12 }}>Tunnel not connected — can't generate invite link yet.</div>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn" onClick={sendInvite} disabled={!inviteeEmail||!tunnelUrl||inviteSending} style={{ background: 'var(--earth)', color: '#fff' }}>{inviteSending ? 'Sending…' : '✉️ Send invite email'}</button>
              <button className="btn btn-sm" onClick={() => { copy(getMagicLink(), 'magic'); }} disabled={!tunnelUrl}>{copied==='magic' ? '✓ Copied!' : '🔗 Copy magic link'}</button>
            </div>
            {inviteResult==='sent' && <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--green-soft)', borderRadius: 8, fontSize: 13, color: 'var(--green)' }}>✓ Invite sent to {inviteeEmail}!</div>}
            {inviteResult==='error' && <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(231,76,60,0.06)', borderRadius: 8, fontSize: 13, color: 'var(--danger)' }}>Failed to send. Copy the magic link instead.</div>}
          </div>
        )}
      </div>
    </div>
  );
}
