import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

// "Add a device" — the delightful path. Mints a scoped (non-owner) key, builds a
// pairing link the web/mobile clients already understand (#tunnel=&key=), and
// shows it as a QR. Scan with a phone camera → connected, no typing.
export default function PairDeviceModal({ bridge, onClose }) {
  const [state, setState] = useState('loading'); // loading | ready | no-tunnel | error
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await bridge.tunnel.getStatus();
        if (!status?.connected || !status?.url) { if (!cancelled) setState('no-tunnel'); return; }
        const base = String(status.url).replace(/\/v1\/?$/, '').replace(/\/+$/, '');
        const created = await bridge.apikeys.create('Paired device', { owner: false, memory: false });
        const secret = created?.secret || created?.key || '';
        const url = `https://runonaspen.com/app#tunnel=${encodeURIComponent(base)}&key=${encodeURIComponent(secret)}`;
        if (!cancelled) { setLink(url); setState('ready'); }
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [bridge]);

  const copy = () => { try { navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ } };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: 'min(420px,94vw)', background: 'var(--bg,#fff)', border: '1px solid var(--brd,#E5E5EA)', borderRadius: 18, boxShadow: '0 16px 50px rgba(0,0,0,.25)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--brd,#E5E5EA)' }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>📱 Add a device</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-light,#8A8A8E)', fontSize: 15 }}>✕</button>
        </div>
        <div style={{ padding: 24, textAlign: 'center' }}>
          {state === 'loading' && <p style={{ color: 'var(--text-light,#8A8A8E)' }}>Preparing your pairing code…</p>}
          {state === 'no-tunnel' && (
            <p style={{ color: 'var(--text-light,#8A8A8E)', lineHeight: 1.6 }}>
              Your Aspen isn’t reachable from other devices yet — the secure tunnel is still connecting.
              Give it a moment and reopen this.
            </p>
          )}
          {state === 'error' && <p style={{ color: '#B45309', lineHeight: 1.6 }}>Couldn’t generate a pairing code. Please try again.</p>}
          {state === 'ready' && (
            <>
              <div style={{ display: 'inline-block', padding: 16, background: '#fff', borderRadius: 14, border: '1px solid var(--brd,#E5E5EA)' }}>
                <QRCodeSVG value={link} size={216} level="M" />
              </div>
              <p style={{ margin: '18px 0 4px', fontSize: 15, fontWeight: 600 }}>Scan with your phone’s camera</p>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-light,#8A8A8E)', lineHeight: 1.55 }}>
                Open the Camera app, point it at this code, and tap the link. Your Aspen connects instantly —
                no typing, no keys.
              </p>
              <button onClick={copy} style={{ marginTop: 18, border: '1px solid var(--brd,#E5E5EA)', background: 'var(--bg2,#F7F7F5)', color: 'var(--bk,#1D1D1F)', borderRadius: 10, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>
                {copied ? '✓ Link copied' : 'Copy link instead'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
