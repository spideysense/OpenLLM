import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../App';

export default function WorldModel() {
  const { bridge, setPage } = useApp();
  const [wm, setWm] = useState({ facts: [], updatedAt: null });
  const [editing, setEditing] = useState(null);
  const [editText, setEditText] = useState('');
  const [newFact, setNewFact] = useState('');
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    if (!bridge) return;
    const data = await bridge.store.get('worldModel').catch(() => null);
    setWm(data && typeof data === 'object' && data.facts ? data : { facts: [], updatedAt: null });
  }, [bridge]);

  useEffect(() => { load(); }, [load]);

  async function save(updated) {
    if (!bridge) return;
    await bridge.store.set('worldModel', { ...updated, updatedAt: new Date().toISOString() });
    setWm(updated); setSaved(true); setTimeout(() => setSaved(false), 1800);
  }

  async function deleteFact(i) {
    const updated = { ...wm, facts: wm.facts.filter((_, idx) => idx !== i) };
    setEditing(null); await save(updated);
  }

  async function commitEdit(i) {
    const trimmed = editText.trim();
    if (!trimmed) { deleteFact(i); return; }
    await save({ ...wm, facts: wm.facts.map((f, idx) => idx === i ? trimmed : f) });
    setEditing(null);
  }

  async function addFact() {
    const trimmed = newFact.trim(); if (!trimmed) return;
    await save({ ...wm, facts: [...(wm.facts || []), trimmed] });
    setNewFact('');
  }

  async function clearAll() {
    if (!confirm('Clear everything the model knows about you?')) return;
    await save({ facts: [], updatedAt: new Date().toISOString() });
  }

  const iconBtn = { background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-light)', padding: '2px 4px', borderRadius: 4, fontSize: 13, flexShrink: 0 };

  return (
    <div className="page">
      <div className="page-title">🧠 Your World Model</div>
      <div className="page-sub">What your local AI knows about you — built from your conversations.</div>

      <div style={{ background: 'rgba(184,134,11,0.06)', border: '1.5px solid rgba(184,134,11,0.15)', borderRadius: 12, padding: '14px 18px', marginBottom: 24, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <span style={{ fontSize: 20 }}>🔒</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--earth)', marginBottom: 3 }}>100% local — never leaves your machine</div>
          <div style={{ fontSize: 13, color: 'var(--text-light)', lineHeight: 1.6 }}>These facts are stored only on your computer. They're never sent to any server. Your local AI uses them to give you more personalized, context-aware answers.</div>
        </div>
      </div>

      <div className="card mb-6" style={{ padding: '14px 18px' }}>
        <div style={{ fontSize: 12, color: 'var(--text-light)', lineHeight: 1.7 }}>
          <strong style={{ color: 'var(--earth)' }}>How it works:</strong> After each conversation, your local model silently extracts facts about you — name, job, preferences, projects, interests. These get prepended to every new chat so your AI remembers who you are. Edit or delete any fact below.
        </div>
      </div>

      <div className="card mb-6" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid rgba(93,78,55,0.08)' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--earth)', fontFamily: 'var(--font-display)' }}>Known facts {saved && <span style={{ color: 'var(--green)', fontSize: 12, fontWeight: 400, marginLeft: 8 }}>✓ Saved</span>}</div>
            {wm.updatedAt && <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 2 }}>Last updated {new Date(wm.updatedAt).toLocaleString()}</div>}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-light)', background: 'var(--sky-top)', padding: '4px 10px', borderRadius: 20 }}>{wm.facts?.length || 0} facts</div>
        </div>

        {!wm.facts?.length ? (
          <div style={{ padding: '32px 18px', textAlign: 'center', color: 'var(--text-light)', fontSize: 14 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🌱</div>
            <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--earth)' }}>Nothing yet</div>
            <div style={{ fontSize: 13, marginBottom: 16 }}>Start chatting and your AI will begin learning about you.</div>
            <button onClick={() => {
              if (bridge?.store) bridge.store.set('pendingPrompt', "Let's get to know each other! Ask me 5 questions one at a time about myself — my name, what I do, where I live, my interests, and what I'm working on. Wait for my answer before asking the next one. Be warm and conversational. At the end, summarize what you learned about me.");
              setPage('chat');
            }} className="btn" style={{ background: 'var(--gold)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              👋 Let's get to know each other
            </button>
          </div>
        ) : (
          <div>
            {wm.facts.map((fact, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', borderBottom: '1px solid rgba(93,78,55,0.07)', fontSize: 14, lineHeight: 1.5, color: 'var(--text-dark)' }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gold,#B8860B)', flexShrink: 0, marginTop: 6 }} />
                {editing === i ? (
                  <>
                    <input style={{ flex: 1, border: '1.5px solid var(--pipe-yellow,#DAA520)', borderRadius: 6, padding: '4px 8px', fontFamily: 'inherit', fontSize: 14, outline: 'none', background: 'var(--sky-top)' }} value={editText} onChange={e=>setEditText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')commitEdit(i);if(e.key==='Escape')setEditing(null)}} autoFocus />
                    <button style={{ ...iconBtn, color: 'var(--green)' }} onClick={() => commitEdit(i)}>✓</button>
                    <button style={{ ...iconBtn, color: 'var(--danger)' }} onClick={() => deleteFact(i)}>✕</button>
                    <button style={iconBtn} onClick={() => setEditing(null)}>✗</button>
                  </>
                ) : (
                  <>
                    <span style={{ flex: 1 }}>{fact}</span>
                    <button style={iconBtn} onClick={() => { setEditing(i); setEditText(fact); }}>✎</button>
                    <button style={{ ...iconBtn, color: 'var(--danger)' }} onClick={() => deleteFact(i)}>✕</button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        <div style={{ padding: '12px 14px', borderTop: '1px solid rgba(93,78,55,0.08)', display: 'flex', gap: 8 }}>
          <input style={{ flex: 1, border: '1.5px solid rgba(93,78,55,0.15)', borderRadius: 8, padding: '7px 11px', fontFamily: 'inherit', fontSize: 13, outline: 'none', background: 'var(--sky-top)' }} placeholder="Add a fact manually (e.g. 'I live in Hillsborough, CA')" value={newFact} onChange={e=>setNewFact(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')addFact()}} />
          <button className="btn btn-sm" onClick={addFact} disabled={!newFact.trim()}>Add</button>
        </div>
      </div>

      {wm.facts?.length > 0 && (
        <div style={{ textAlign: 'right' }}>
          <button className="btn" onClick={clearAll} style={{ background: 'transparent', color: 'var(--danger)', border: '1.5px solid rgba(220,38,38,.25)', fontSize: 13 }}>Clear everything</button>
        </div>
      )}
    </div>
  );
}
