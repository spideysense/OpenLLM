import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

// Invite a family member: mints a NAMED key (its own private memory + safe tools,
// no computer use) and shows a QR they scan to get their own private space on
// this box. Same local pairing link the clients already understand (#tunnel=&key=).
export default function InviteFamilyModal({ bridge, onClose }) {
  const [name, setName] = useState('');
  const [state, setState] = useState('form'); // form | working | ready | error
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);

  async function createInvite() {
    const label = name.trim();
    if (!label) return;
    setState('working');
    try {
      const status = await bridge.tunnel.getStatus();
      if (!status?.connected || !status?.url) { setState('no-tunnel'); return; }
      const base = String(status.url).replace(/\/v1\/?$/, '').replace(/\/+$/, '');
      const created = await bridge.apikeys.create(label, { owner: false, memory: true });
      const secret = created?.secret || created?.key || '';
      setLink(`https://runonaspen.com/app#tunnel=${encodeURIComponent(base)}&key=${encodeURIComponent(secret)}`);
      setState('ready');
    } catch {
      setState('error');
    }
  }

  const copy = () => { try { navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ } };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: 'min(420px,94vw)', background: 'var(--bg,#fff)', border: '1px solid var(--brd,#E5E5EA)', borderRadius: 18, boxShadow: '0 16px 50px rgba(0,0,0,.25)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--brd,#E5E5EA)' }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>👪 Invite a family member</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-light,#8A8A8E)', fontSize: 15 }}>✕</button>
        </div>
        <div style={{ padding: 24, textAlign: 'center' }}>
          {state === 'form' && (
            <>
              <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--text-light,#8A8A8E)', lineHeight: 1.55 }}>
                They get their own private space on your Aspen — their own chats and memory, never mixed with yours. Everything still runs on your machine.
              </p>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') createInvite(); }}
                placeholder="Their name (e.g. Mom, Priya)"
                style={{ width: '100%', border: '1px solid var(--brd,#E5E5EA)', borderRadius: 10, padding: '10px 14px', fontSize: 14, outline: 'none', background: 'var(--bg,#fff)', color: 'var(--bk,#1D1D1F)' }}
              />
              <button onClick={createInvite} disabled={!name.trim()} style={{ marginTop: 16, width: '100%', border: 'none', background: 'var(--gd,#5B8C6E)', color: '#fff', borderRadius: 10, padding: '11px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: name.trim() ? 1 : 0.5 }}>
                Create invite
              </button>
            </>
          )}
          {state === 'working' && <p style={{ color: 'var(--text-light,#8A8A8E)' }}>Creating {name.trim()}’s invite…</p>}
          {state === 'no-tunnel' && <p style={{ color: 'var(--text-light,#8A8A8E)', lineHeight: 1.6 }}>Your Aspen isn’t reachable from other devices yet — the secure tunnel is still connecting. Try again in a moment.</p>}
          {state === 'error' && <p style={{ color: '#B45309', lineHeight: 1.6 }}>Couldn’t create the invite. Please try again.</p>}
          {state === 'ready' && (
            <>
              <div style={{ display: 'inline-block', padding: 16, background: '#fff', borderRadius: 14, border: '1px solid var(--brd,#E5E5EA)' }}>
                <QRCodeSVG value={link} size={216} level="M" />
              </div>
              <p style={{ margin: '18px 0 4px', fontSize: 15, fontWeight: 600 }}>Have {name.trim()} scan this</p>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-light,#8A8A8E)', lineHeight: 1.55 }}>
                They point their phone camera at this code and tap the link — connected to their own private space, no typing.
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
