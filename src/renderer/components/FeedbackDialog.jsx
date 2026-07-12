import { useEffect, useRef, useState } from 'react';

// Short AI feedback conversation, run on the user's own box via the isolated
// bridge.feedback.chat channel. Progressive: every answer posts to the API so a
// bailed conversation still delivers.
const FB_SYS =
  "You are Aspen's feedback assistant. Have a brief, warm, natural conversation (about 30-60 seconds) to learn about this user. Ask ONE short question at a time. Cover exactly three things, in order: (1) how they found Aspen; (2) why they downloaded it / what they hoped it would do; (3) whether it's serving that purpose and what else they need. React to each answer in at most one sentence before asking the next question. Keep every message to one or two short sentences. Do not lecture or pitch. After the third topic is covered, thank them warmly in one sentence and end that final message with the token [[DONE]] on its own line. Never write [[DONE]] before you are finished. Begin now with a one-line friendly intro and question 1.";

const API = 'https://runonaspen.com/api/feedback';

export default function FeedbackDialog({ bridge, model, onClose }) {
  const [lines, setLines] = useState([]); // {role, text}
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const sessionId = useRef('fb_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
  const turn = useRef(0);
  const bodyRef = useRef(null);
  const linesRef = useRef([]);
  linesRef.current = lines;

  useEffect(() => { if (lines.length === 0) botTurn([]); /* open with intro+Q1 */ }, []); // eslint-disable-line
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [lines, busy]);

  function post(status) {
    try {
      const transcript = linesRef.current.map((l) => ({ role: l.role, content: l.text }));
      fetch(API, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionId.current, transcript, status, surface: 'desktop', turn: turn.current }),
        keepalive: true,
      }).catch(() => {});
    } catch { /* ignore */ }
  }

  async function botTurn(currentLines) {
    if (busy) return;
    setBusy(true);
    try {
      const msgs = [{ role: 'system', content: FB_SYS }, ...currentLines.map((l) => ({ role: l.role, content: l.text }))];
      const reply = (await bridge.feedback.chat(model || 'llama3', msgs)) || '';
      const done = /\[\[DONE\]\]/.test(reply);
      let clean = reply.replace(/\[\[DONE\]\]/g, '').trim();
      if (!clean && !done) clean = 'Thanks — you can also email feedback@runonaspen.com anytime.';
      if (clean) setLines((ls) => [...ls, { role: 'assistant', text: clean }]);
      if (done) { setFinished(true); post('complete'); setTimeout(onClose, 2400); }
    } catch {
      setLines((ls) => [...ls, { role: 'assistant', text: 'Thanks — you can also email feedback@runonaspen.com anytime.' }]);
    } finally {
      setBusy(false);
    }
  }

  function sendAnswer() {
    const t = input.trim();
    if (!t || busy || finished) return;
    setInput('');
    const next = [...linesRef.current, { role: 'user', text: t }];
    setLines(next);
    turn.current += 1;
    // post after state settles (linesRef updates synchronously above via next)
    linesRef.current = next;
    post('partial');
    botTurn(next);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,.28)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: '0 0 20px' }}>
      <div style={{ width: 'min(440px,94vw)', maxHeight: '70vh', background: 'var(--bg,#fff)', border: '1px solid var(--brd,#E5E5EA)', borderRadius: 16, boxShadow: '0 12px 40px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid var(--brd,#E5E5EA)' }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>🌿 Quick question or two</span>
          <button onClick={() => { post('partial'); onClose(); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t3,#8A8A8E)', fontSize: 14 }}>✕</button>
        </div>
        <div ref={bodyRef} style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 180 }}>
          {lines.map((l, i) => (
            <div key={i} style={{ alignSelf: l.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%', padding: '9px 13px', borderRadius: 14, fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap', background: l.role === 'user' ? 'var(--gd,#5B8C6E)' : 'var(--bg2,#F2F2F4)', color: l.role === 'user' ? '#fff' : 'var(--bk,#1D1D1F)' }}>{l.text}</div>
          ))}
          {busy && <div style={{ alignSelf: 'flex-start', color: 'var(--t3,#8A8A8E)', fontSize: 14 }}>…</div>}
        </div>
        <div style={{ display: 'flex', gap: 8, padding: '10px 12px', borderTop: '1px solid var(--brd,#E5E5EA)' }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sendAnswer(); } }}
            disabled={finished || busy}
            placeholder={finished ? 'Thanks for the feedback 🌿' : 'Type your answer…'}
            style={{ flex: 1, border: '1px solid var(--brd,#E5E5EA)', borderRadius: 20, padding: '9px 14px', fontSize: 14, outline: 'none', background: 'var(--bg,#fff)', color: 'var(--bk,#1D1D1F)' }}
          />
          <button onClick={sendAnswer} disabled={finished || busy || !input.trim()} style={{ border: 'none', background: 'var(--gd,#5B8C6E)', color: '#fff', borderRadius: 20, padding: '0 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Send</button>
        </div>
      </div>
    </div>
  );
}
