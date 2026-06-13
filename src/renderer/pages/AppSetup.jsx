import React, { useState, useEffect } from 'react';
import { useApp } from '../App';

export default function AppSetup() {
  const { bridge, gatewayStatus, tunnelStatus } = useApp();
  const [keys, setKeys] = useState([]);
  const [copied, setCopied] = useState(null);
  const [revealed, setRevealed] = useState(false);

  const port = gatewayStatus?.port || 4000;
  const localUrl = `http://localhost:${port}/v1`;
  const tunnelUrl = tunnelStatus?.connected && tunnelStatus?.url ? `${tunnelStatus.url}/v1` : null;
  const defaultKey = keys[0];

  useEffect(() => {
    if (bridge?.apikeys) bridge.apikeys.list().then(setKeys).catch(() => {});
  }, [bridge]);

  function copy(text, id) {
    if (bridge?.clipboard?.write) bridge.clipboard.write(text);
    else navigator.clipboard.writeText(text).catch(() => {});
    setCopied(id); setTimeout(() => setCopied(null), 2000);
  }

  function getMagicLink() {
    if (!defaultKey || !tunnelUrl) return 'https://runonaspen.com/app';
    const base = tunnelUrl.replace(/\/v1$/, '');
    const params = new URLSearchParams({ tunnel: base, key: defaultKey.secret });
    return `https://runonaspen.com/app#${params.toString()}`;
  }

  function openWebApp() { bridge?.app.openExternal(getMagicLink()); }

  const btnStyle = (id) => ({ flexShrink: 0, background: copied === id ? 'var(--grass-dark)' : undefined, color: copied === id ? '#fff' : undefined });

  return (
    <div className="page">
      <div className="page-title">📱 App Setup</div>
      <div className="page-sub">Connect any browser or device to your local Aspen.</div>

      <div className="card mb-6" style={{ background: 'rgba(0,0,0,0.04)', border: '1.5px solid rgba(0,0,0,0.1)' }}>
        <p style={{ fontSize: 13, color: 'var(--text-light)', lineHeight: 1.7, margin: 0 }}>
          <strong style={{ color: 'var(--earth)' }}>runonaspen.com/app</strong> is a web interface that connects directly to your local Aspen. Copy your tunnel URL and API key below, then paste them at the web app. Every message routes through your machine — nothing is stored on any server.
        </p>
      </div>

      <div className="card mb-6">
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, color: 'var(--earth)', marginBottom: 4 }}>🌐 Step 1 — Copy your Tunnel URL</h3>
        <p style={{ fontSize: 13, color: 'var(--text-light)', marginBottom: 14, lineHeight: 1.5 }}>Your permanent public address. Use it from any browser, anywhere.</p>
        {tunnelUrl ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--sky-top)', borderRadius: 8, padding: '10px 14px' }}>
            <code style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dark)', wordBreak: 'break-all' }}>{tunnelUrl}</code>
            <button className="btn btn-sm" onClick={() => copy(tunnelUrl, 'tunnel')} style={btnStyle('tunnel')}>{copied==='tunnel' ? '✓ Copied' : 'Copy'}</button>
          </div>
        ) : (
          <div style={{ padding: '12px 14px', background: 'rgba(231,76,60,0.06)', borderRadius: 8, fontSize: 13, color: 'var(--danger)', border: '1px solid rgba(231,76,60,0.15)' }}>Tunnel not connected. Check your internet connection or restart Aspen.</div>
        )}
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--text-light)' }}>Or on this machine only:</span>
          <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-mid)', background: 'var(--sky-top)', padding: '2px 8px', borderRadius: 5 }}>{localUrl}</code>
          <button className="btn btn-sm" style={{ fontSize: 11, padding: '3px 10px', ...(copied==='local'?{background:'var(--grass-dark)',color:'#fff'}:{}) }} onClick={() => copy(localUrl, 'local')}>{copied==='local' ? '✓' : 'Copy'}</button>
        </div>
      </div>

      <div className="card mb-6">
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, color: 'var(--earth)', marginBottom: 4 }}>🔑 Step 2 — Copy an API Key</h3>
        <p style={{ fontSize: 13, color: 'var(--text-light)', marginBottom: 14, lineHeight: 1.5 }}>The web app uses this to authenticate. Keys never leave your machine.</p>
        {defaultKey ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--sky-top)', borderRadius: 8, padding: '10px 14px' }}>
            <code style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dark)', wordBreak: 'break-all' }}>
              {revealed ? defaultKey.secret : defaultKey.secret.slice(0, 14) + '••••••••••••'}
            </code>
            <button className="btn btn-sm" style={{ flexShrink: 0, background: 'transparent', border: '1.5px solid rgba(0,0,0,0.2)', color: 'var(--text-light)' }} onClick={() => setRevealed(!revealed)}>{revealed ? 'Hide' : 'Reveal'}</button>
            <button className="btn btn-sm" onClick={() => copy(defaultKey.secret, 'key')} style={btnStyle('key')}>{copied==='key' ? '✓ Copied' : 'Copy'}</button>
          </div>
        ) : (
          <div style={{ padding: '12px 14px', background: 'rgba(245,166,35,0.08)', borderRadius: 8, fontSize: 13, color: 'var(--earth)', border: '1px solid rgba(245,166,35,0.2)' }}>No API keys yet. Go to <strong>API Keys</strong> in the sidebar to create one.</div>
        )}
      </div>

      <div className="card">
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, color: 'var(--earth)', marginBottom: 4 }}>✅ Step 3 — Open the web app</h3>
        <p style={{ fontSize: 13, color: 'var(--text-light)', marginBottom: 14, lineHeight: 1.5 }}>Paste your tunnel URL and API key when prompted. Or use the magic link — it opens already connected.</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn" onClick={openWebApp} style={{ background: 'var(--earth)', color: '#fff' }}>Open runonaspen.com/app →</button>
          <button className="btn btn-sm" onClick={() => { copy(getMagicLink(), 'magic'); }} style={btnStyle('magic')}>{copied==='magic' ? '✓ Magic link copied' : 'Copy magic link'}</button>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-light)', marginTop: 10, lineHeight: 1.5 }}>The magic link opens the web app already connected — no manual paste needed.</p>
      </div>
    </div>
  );
}
