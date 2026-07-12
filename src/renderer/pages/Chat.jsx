import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useApp } from '../App';
import tts from '../lib/tts';
import FeedbackDialog from '../components/FeedbackDialog';

// ── Savings counter ──
// Based on Claude Opus 4 API pricing: $15/M input tokens, $75/M output tokens
// Avg per exchange: ~200 input tokens + ~500 output tokens ≈ $0.04/exchange
const COST_PER_EXCHANGE = 0.040;
const VISION_MODELS = ['llava', 'llava-llama3', 'moondream', 'bakllava', 'llava-phi3'];
// Languages that can render in the artifact preview panel. Declared at module top
// (not below the component) so it's initialized before Chat's callbacks reference
// it — otherwise the bundler hits a temporal dead zone: "Cannot access before
// initialization", which blanks the whole renderer.
const RUNNABLE = ['html', 'svg'];

function isVisionModel(modelName) {
  if (!modelName) return false;
  return VISION_MODELS.some((v) => modelName.toLowerCase().includes(v));
}

export default function Chat() {
  const { bridge, activeModel, selectModel, models, setPage, modelProfile,
    conversations, setConversations, activeConvo, setActiveConvo, newConvo, deleteConvo,
    missions, viewingMissionId, setViewingMissionId } = useApp();
  const [input, setInput] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState('');
  const streamBufferRef = useRef('');
  // Live reasoning trail (status + tool steps) for the in-progress message.
  const [trail, setTrail] = useState([]);
  const trailRef = useRef([]);
  const streamConvIdRef = useRef(null); // which conversation the live stream belongs to
  const [attachments, setAttachments] = useState([]); // { type: 'image'|'text', name, data, preview }
  const [isListening, setIsListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [totalExchanges, setTotalExchanges] = useState(0);
  const [smallModelDismissed, setSmallModelDismissed] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [connMenuOpen, setConnMenuOpen] = useState(false);
  const [connectorList, setConnectorList] = useState([]);
  const [connBusy, setConnBusy] = useState(null);
  const [codeTipDismissed, setCodeTipDismissed] = useState(false);
  const [artifact, setArtifact] = useState(null); // { code, lang } open in side panel
  const [artifactTab, setArtifactTab] = useState('preview');
  const [modelIsVision, setModelIsVision] = useState(true);
  const [pulling, setPulling] = useState(null); // { model, percent, status }
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const recognitionRef = useRef(null);
  const saveTimer = useRef(null);

  // Voice conversation mode (like GPT voice)
  const [voiceMode, setVoiceMode] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [ttsReady, setTtsReady] = useState(false);
  const [ttsDownloading, setTtsDownloading] = useState(false);
  const [ttsProgress, setTtsProgress] = useState(0);
  const voiceModeRef = useRef(false);
  const pendingSentences = useRef([]);
  const speakingQueue = useRef(false);

  // ── Connector quick-menu (the "+" in the composer) ──
  const loadConnectors = useCallback(async () => {
    try {
      const list = await window.aspen?.connectors?.list?.();
      setConnectorList(list || []);
    } catch { setConnectorList([]); }
  }, []);

  async function quickConnect(c) {
    // Token-based connectors can't be set up inline — send the user to the full page.
    if (c.needsToken && !c.hasToken) { setConnMenuOpen(false); setPage('connectors'); return; }
    setConnBusy(c.id);
    try {
      if (c.connected) await window.aspen.connectors.disconnect(c.id);
      else await window.aspen.connectors.connect(c.id);
      await loadConnectors();
    } finally { setConnBusy(null); }
  }

  useEffect(() => { if (connMenuOpen) loadConnectors(); }, [connMenuOpen, loadConnectors]);
  useEffect(() => { loadConnectors(); }, [loadConnectors]);

  const openArtifact = useCallback((code, lang) => {
    setArtifact({ code, lang });
    setArtifactTab(RUNNABLE.includes(lang) ? 'preview' : 'code');
  }, []);

  // Is the active model able to see images? (drives the attach-image gate)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!activeModel) return;
      try {
        const v = await window.aspen?.ollama?.isVisionModel?.(activeModel);
        if (!cancelled) setModelIsVision(!!v);
      } catch { if (!cancelled) setModelIsVision(true); }
    })();
    return () => { cancelled = true; };
  }, [activeModel]);

  // One-tap pull of a vision model, with live progress.
  const pullVisionModel = useCallback(async () => {
    let model = 'llava';
    try { model = await window.aspen?.ollama?.recommendedVisionModel?.() || 'llava'; } catch {}
    setPulling({ model, percent: null, status: 'starting' });
    const unsub = window.aspen?.ollama?.onPullProgress?.((p) => {
      setPulling((cur) => cur ? { ...cur, percent: p.percent, status: p.status } : cur);
    });
    try {
      const res = await window.aspen?.ollama?.pullModel?.(model);
      if (res?.success) {
        // Switch to the freshly pulled vision model if the app exposes selectModel.
        try { selectModel?.(model); } catch {}
        setModelIsVision(true);
      }
    } finally {
      unsub?.();
      setPulling(null);
    }
  }, [selectModel]);

  const hasImageAttached = attachments.some((a) => a.type === 'image');
  const showVisionGate = hasImageAttached && !modelIsVision;

  const convo = useMemo(() => conversations.find((c) => c.id === activeConvo), [conversations, activeConvo]);
  const messages = useMemo(() => convo?.messages || [], [convo]);

  // One-time coding tip: show when the conversation has code, GitHub isn't
  // connected, and the user hasn't dismissed it. Connectors run on desktop, so
  // this lives here where it's actually actionable.
  const convoHasCode = useMemo(
    () => messages.some((m) => typeof m.content === 'string' && m.content.includes('```')),
    [messages]
  );
  const githubConnected = connectorList.some((c) => c.id === 'github' && c.connected);
  const showCodeTip = convoHasCode && !githubConnected && !codeTipDismissed;

  // Load saved exchange count
  useEffect(() => {
    if (!bridge) return;
    bridge.store.get('totalExchanges').then((n) => setTotalExchanges(n || 0)).catch(() => {});
  }, [bridge]);

  // Setup TTS
  useEffect(() => {
    tts.setCallbacks({
      onProgress: (pct) => { setTtsDownloading(true); setTtsProgress(pct); },
      onReady: () => { setTtsReady(true); setTtsDownloading(false); },
    });
    tts.preload(); // start download in background
  }, []);

  const moneySaved = (totalExchanges * COST_PER_EXCHANGE).toFixed(2);

  // Check voice support
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    setVoiceSupported(!!SR);
  }, []);

  // Scroll to bottom
  // ── Pick up pending prompt from templates/demos ──
  useEffect(() => {
    if (!bridge?.store) return;
    bridge.store.get('pendingPrompt').then(p => {
      if (p && typeof p === 'string') {
        setInput(p);
        bridge.store.set('pendingPrompt', '');
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    }).catch(() => {});
  }, [bridge]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    function handleKey(e) {
      const meta = e.metaKey || e.ctrlKey;
      // Cmd+N — new chat (inline to avoid temporal dead zone with newConvo)
      if (meta && e.key === 'n') {
        e.preventDefault();
        setConversations(cs => {
          const id = Math.max(...cs.map(c => c.id), 0) + 1;
          return [...cs, { id, title: 'New Chat', messages: [] }];
        });
      }
      // Cmd+E — export conversation as markdown
      if (meta && e.key === 'e') {
        e.preventDefault();
        const md = messages.map(m => `**${m.role === 'user' ? 'You' : 'Aspen'}:**\n${m.content}\n`).join('\n---\n\n');
        const blob = new Blob([md], { type: 'text/markdown' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
        a.download = `aspen-chat-${new Date().toISOString().split('T')[0]}.md`; a.click();
      }
      // Cmd+Shift+C — copy last code block
      if (meta && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        const last = [...messages].reverse().find(m => m.role === 'assistant');
        const code = last?.content?.match(/```[\w]*\n([\s\S]*?)```/)?.[1];
        if (code) navigator.clipboard?.writeText(code);
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamBuffer]);

  // Stream chunks
  useEffect(() => {
    if (!bridge) return;
    const unsub = bridge.chat.onStream((chunk) => {
      // Reasoning-trail event (status / tool step) — accumulate, don't treat as
      // answer content. Mirrors the web/mobile live trail.
      if (chunk.aspen_status) {
        const step = { status: chunk.aspen_status, tool: chunk.aspen_tool || null, transient: !!chunk.aspen_transient };
        trailRef.current = [...trailRef.current, step];
        setTrail(trailRef.current);
        return;
      }
      if (chunk.done) {
        setIsStreaming(false);
        // After the first completed reply: once per user, show the feedback dialog.
        try {
          if (!localStorage.getItem('aspen_fb_v1')) {
            localStorage.setItem('aspen_fb_v1', 'shown');
            setTimeout(() => setShowFeedback(true), 1500);
          }
        } catch { /* ignore */ }
        // Transient steps (e.g. "Loading model…") are live-only — never saved.
        const finishedTrail = trailRef.current.filter((s) => !s.transient);
        trailRef.current = [];
        setTrail([]);

        // Read the final content from the ref — NOT from inside a setState
        // updater. Committing the assistant message here, in the plain stream
        // handler, means React can never double-invoke a side-effecting updater
        // and append the same message twice (the double-bubble bug).
        const finalContent = streamBufferRef.current + (chunk.content || '');
        streamBufferRef.current = '';
        setStreamBuffer('');

        const targetConvId = streamConvIdRef.current ?? activeConvo;
        setConversations((cs) =>
          cs.map((c) =>
            c.id === targetConvId
              ? {
                  ...c,
                  messages: [...c.messages, { role: 'assistant', content: finalContent, trail: finishedTrail.length ? finishedTrail : undefined }],
                  title: c.messages.length === 0 ? (c.messages[0]?.content || 'Chat').slice(0, 40) : c.title,
                }
              : c
          )
        );
        streamConvIdRef.current = null;

        if (voiceModeRef.current) {
          const sentences = tts.splitIntoSentences(finalContent);
          if (sentences.length > 0) {
            setIsSpeaking(true);
            (async () => {
              for (const sentence of sentences) {
                if (!voiceModeRef.current) break;
                await tts.speak(sentence);
              }
              setIsSpeaking(false);
              if (voiceModeRef.current) setTimeout(() => startListening(), 500);
            })();
          }
        }

        setTotalExchanges((prev) => {
          const next = prev + 1;
          bridge?.store.set('totalExchanges', next).catch(() => {});
          return next;
        });
      } else {
        streamBufferRef.current += (chunk.content || '');
        setStreamBuffer(streamBufferRef.current);
      }
    });
    return unsub;
  }, [bridge, activeConvo]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || isStreaming || !activeModel) return;

    // Build message with optional attachments
    const userMsg = { role: 'user', content: text || '(see attachment)' };
    if (attachments.some((a) => a.type === 'image')) {
      userMsg.images = attachments.filter((a) => a.type === 'image').map((a) => a.data);
    }
    if (attachments.some((a) => a.type === 'text')) {
      const textContent = attachments.filter((a) => a.type === 'text').map((a) =>
        `[File: ${a.name}]\n\`\`\`\n${a.data}\n\`\`\``
      ).join('\n\n');
      userMsg.content = textContent + (text ? `\n\n${text}` : '');
    }

    // Include image previews in UI message
    const uiMsg = { ...userMsg, attachmentPreviews: attachments.map((a) => ({ name: a.name, type: a.type, preview: a.preview })) };
    const updatedMessages = [...messages, uiMsg];

    setConversations((prev) =>
      prev.map((c) =>
        c.id === activeConvo
          ? { ...c, messages: updatedMessages, title: c.messages.length === 0 ? (text || 'Attachment').slice(0, 40) : c.title }
          : c
      )
    );

    setInput('');
    setAttachments([]);
    setViewingMissionId(null);
    streamConvIdRef.current = activeConvo;
    setIsStreaming(true);
    setStreamBuffer('');
    trailRef.current = [];
    setTrail([]);

    if (bridge) {
      // Pass messages without uiMsg extras (Ollama doesn't want attachmentPreviews)
      const apiMessages = updatedMessages.map(({ attachmentPreviews, ...m }) => m);
      await bridge.chat.send(activeModel, apiMessages);
    }
  }, [input, attachments, isStreaming, activeModel, messages, bridge, activeConvo]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  // ── Voice Input ──
  const toggleVoice = useCallback(() => {
    if (!voiceSupported) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (e) => {
      const transcript = Array.from(e.results).map((r) => r[0].transcript).join('');
      setInput(transcript);
    };

    recognition.onend = () => setIsListening(false);
    recognition.onerror = (e) => { console.error('[Voice]', e.error); setIsListening(false); };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [isListening, voiceSupported]);

  // ── Voice conversation mode ──
  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR || !voiceModeRef.current) return;
    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.onresult = (e) => {
      const text = e.results[0]?.[0]?.transcript?.trim();
      if (text && voiceModeRef.current) {
        setInput(text);
        // Auto-send
        setTimeout(() => {
          document.getElementById('chat-send-btn')?.click();
        }, 100);
      }
    };
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);
    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  }, []);

  const enterVoiceMode = useCallback(() => {
    if (!ttsReady && !ttsDownloading) {
      // Trigger download if not started
      tts.preload();
      return;
    }
    if (!ttsReady) return; // still downloading
    voiceModeRef.current = true;
    setVoiceMode(true);
    tts.stop();
    startListening();
  }, [ttsReady, ttsDownloading, startListening]);

  const exitVoiceMode = useCallback(() => {
    voiceModeRef.current = false;
    setVoiceMode(false);
    setIsListening(false);
    setIsSpeaking(false);
    recognitionRef.current?.stop();
    tts.stop();
  }, []);

  // ── File Attachments ──
  const handleFileSelect = useCallback(async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    const DOC_EXT = /\.(pdf|docx|xlsx|xls)$/i;

    const newAttachments = await Promise.all(files.map((file) => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        const isImage = file.type.startsWith('image/');
        const isDoc = DOC_EXT.test(file.name);

        if (isImage) {
          reader.onload = (ev) => {
            const base64 = ev.target.result.split(',')[1]; // strip data:image/...;base64,
            resolve({ type: 'image', name: file.name, data: base64, preview: ev.target.result });
          };
          reader.readAsDataURL(file);
        } else if (isDoc) {
          // PDF / Word / Excel: send bytes to main for local text extraction.
          reader.onload = async (ev) => {
            const base64 = ev.target.result.split(',')[1];
            try {
              const res = await window.aspen?.files?.extractText?.({ name: file.name, base64 });
              if (res?.ok && res.text) {
                const note = res.truncated ? '\n\n[Note: document was long; only the first part is included.]' : '';
                resolve({ type: 'text', name: file.name, data: `--- Content of ${file.name} ---\n${res.text}${note}`, preview: null });
              } else {
                resolve({ type: 'text', name: file.name, data: `[Could not read ${file.name}: ${res?.error || 'unsupported file'}]`, preview: null });
              }
            } catch (err) {
              resolve({ type: 'text', name: file.name, data: `[Could not read ${file.name}: ${err.message}]`, preview: null });
            }
          };
          reader.readAsDataURL(file);
        } else {
          reader.onload = (ev) => {
            resolve({ type: 'text', name: file.name, data: ev.target.result, preview: null });
          };
          reader.readAsText(file);
        }
      });
    }));

    setAttachments((prev) => [...prev, ...newAttachments]);
    e.target.value = ''; // reset input
  }, []);

  const removeAttachment = (idx) => setAttachments((prev) => prev.filter((_, i) => i !== idx));

  // Paste an image straight into the composer (Cmd/Ctrl+V a screenshot) — parity
  // with the web app. Text paste falls through to default behaviour.
  const handlePaste = useCallback((e) => {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    const imageFiles = [];
    for (const it of items) {
      if (it.type && it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) imageFiles.push(f);
      }
    }
    if (!imageFiles.length) return; // not an image → let normal paste happen
    e.preventDefault();
    Promise.all(imageFiles.map((file) => new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (ev) => resolve({
        type: 'image',
        name: file.name || 'pasted-image.png',
        data: ev.target.result.split(',')[1],
        preview: ev.target.result,
      });
      reader.readAsDataURL(file);
    }))).then((atts) => setAttachments((prev) => [...prev, ...atts]));
  }, []);

  const stopStreaming = () => {
    if (bridge) bridge.chat.stop();
    setIsStreaming(false);
  };

  // ── Drag & drop files ──
  const [dragOver, setDragOver] = useState(false);
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer?.files;
    if (files?.length) {
      // Reuse the existing file handler by creating a synthetic event
      handleFileSelect({ target: { files } });
    }
  }, [handleFileSelect]);

  const hasVision = isVisionModel(activeModel);

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {showFeedback && (
        <FeedbackDialog bridge={bridge} model={activeModel} onClose={() => setShowFeedback(false)} />
      )}      {/* Main chat area (chat list now lives in the left sidebar, Ollama-style) */}
      <div className="chat-container" style={{ flex: 1, minWidth: 0 }}>
      {/* Header */}
      <div className="chat-header">
        <h2>Chat</h2>

        <div style={{ flex: 1 }} />

        <button onClick={() => setPage('templates')} title="Start from a template"
          style={{ padding: '4px 10px', border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 'var(--radius-pill)', background: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text-light)' }}>📋 Templates</button>


        {messages.length > 0 && (
          <button onClick={() => {
            const md = messages.map(m => `**${m.role === 'user' ? 'You' : 'Aspen'}:**\n${m.content}\n`).join('\n---\n\n');
            const blob = new Blob([md], { type: 'text/markdown' });
            const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
            a.download = `aspen-chat-${new Date().toISOString().split('T')[0]}.md`; a.click();
          }} title="Export as Markdown (⌘E)" style={{ padding: '4px 8px', border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 'var(--radius-pill)', background: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text-light)' }}>↓ Export</button>
        )}

        <button onClick={() => setPage('worldmodel')} title="What Aspen knows about you"
          style={{ padding: '4px 8px', border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 'var(--radius-pill)', background: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text-light)' }}>🧠 Memory</button>

        <select
          value={activeModel || ''}
          onChange={(e) => selectModel(e.target.value)}
          style={{ padding: '6px 12px', borderRadius: 'var(--radius-pill)', border: '1.5px solid rgba(0,0,0,0.12)', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, background: 'var(--cloud)', color: 'var(--earth)', cursor: 'pointer' }}
        >
          {models.length === 0 && <option value="">No models installed</option>}
          {models.map((m) => (
            <option key={m.name} value={m.name}>{m.name}</option>
          ))}
        </select>

        <button className="btn btn-sm btn-secondary" onClick={newConvo} style={{ display: 'none' }}>+ New</button>
      </div>

      {/* Capability note — shown only when the model is chat-tier (features removed) */}
      {(() => {
        if (!modelProfile || modelProfile.tier !== 'chat' || smallModelDismissed) return null;
        return (
          <div style={{ margin: '0 24px', padding: '10px 14px', background: 'rgba(242,213,138,0.14)', border: '1px solid rgba(0,0,0,0.3)', borderRadius: 10, fontSize: 13, color: '#7a5e12', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ flex: 1 }}>💬 <strong>{activeModel}</strong> runs as a fast chat model. Web search, code execution, research, and computer use need a larger model (5B+). Everything else works normally.</span>
            <button onClick={() => setSmallModelDismissed(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#7a5e12', padding: '0 4px' }}>✕</button>
          </div>
        );
      })()}

      {/* Messages */}
      <div className="chat-messages"
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onScroll={(e) => { const el = e.target; setShowScrollBtn(el.scrollHeight - el.scrollTop - el.clientHeight > 200); }}
        style={dragOver ? { outline: '2px dashed var(--gold)', outlineOffset: -4, background: 'rgba(0,0,0,0.04)' } : {}}
      >
        {viewingMissionId && (() => {
          const m = (missions || []).find((x) => x.id === viewingMissionId);
          if (!m) return <div style={{ padding: 24, color: 'var(--text-light)' }}>Mission not found.</div>;
          const journal = m.journal || [];
          const label = { active: 'Working…', done: 'Done', blocked: 'Blocked', stopped: 'Stopped' }[m.status] || m.status;
          return (
            <div style={{ maxWidth: 720, margin: '0 auto', padding: '1.5rem 1rem 3rem' }}>
              <div style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-light)' }}>Mission · {label} · {m.steps} steps</div>
              <h2 style={{ fontSize: '1.35rem', margin: '.4rem 0 1rem', fontWeight: 600 }}>{m.goal}</h2>
              {m.status === 'active' && (
                <button onClick={() => bridge?.missions?.stop(m.id)} style={{ fontSize: 12, padding: '5px 12px', border: '1px solid rgba(0,0,0,.12)', borderRadius: 8, background: 'transparent', cursor: 'pointer', marginBottom: 20 }}>Stop mission</button>
              )}
              {journal.length ? journal.map((s, i) => (
                <div key={i} style={{ padding: '14px 0', borderBottom: '1px solid rgba(0,0,0,.06)', whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: 14 }}>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-light)', marginBottom: 4 }}>Step {i + 1}</div>
                  {String(s)}
                </div>
              )) : <div style={{ color: 'var(--text-light)', padding: '1rem 0' }}>Getting started — the first update appears here shortly.</div>}
            </div>
          );
        })()}

        {!viewingMissionId && messages.length === 0 && !(streamBuffer && streamConvIdRef.current === activeConvo) && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 24px' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>What can I help with?</div>
            <div style={{ fontSize: 13, color: 'var(--text-light)', marginBottom: 24, textAlign: 'center' }}>100% private — everything stays on your machine</div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, width: '100%', maxWidth: 500 }}>
              {[
                { icon: '✍️', label: 'Write for me', prompt: 'Help me write a professional email to my boss about taking time off next week. Keep it polite and brief.' },
                { icon: '📸', label: 'Analyze a photo', prompt: 'I\'ll share a photo — please describe what you see and answer any questions about it.' },
                { icon: '🎮', label: 'Build me an app', prompt: 'Build me a fun interactive web app — surprise me with something creative and visually polished!' },
                { icon: '🔍', label: 'Research a topic', prompt: 'Research the latest developments in AI and give me a comprehensive summary with sources.' },
                { icon: '📝', label: 'Fix my writing', prompt: 'I\'ll paste some text — please fix the grammar, improve clarity, and make it more professional.' },
                { icon: '🧑‍🏫', label: 'Teach me something', prompt: 'Teach me something fascinating I probably don\'t know — explain it simply with examples, like I\'m a curious beginner.' },
                { icon: '💡', label: 'Brainstorm ideas', prompt: 'Help me brainstorm creative ideas. Ask me what topic or problem I\'m working on and then generate 10 unique approaches.' },
                { icon: '🌐', label: 'Translate text', prompt: 'I\'ll share some text — please translate it. Ask me what language I want it in.' },
                { icon: '👋', label: 'Get to know me', prompt: 'Let\'s get to know each other! Ask me 5 questions one at a time about myself — my name, what I do, where I live, my interests, and what I\'m working on. Wait for my answer before asking the next one. Be warm and conversational. At the end, summarize what you learned about me.' },
              ].map((card, i) => (
                <button key={i} onClick={() => { setInput(card.prompt); setTimeout(() => inputRef.current?.focus(), 50); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', border: '1.5px solid rgba(0,0,0,.1)', borderRadius: 12, background: 'var(--cloud, #fff)', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--text-dark)', textAlign: 'left', transition: 'all .15s' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--gold)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(0,0,0,.1)'; e.currentTarget.style.transform = 'none'; }}
                >
                  <span style={{ fontSize: 18 }}>{card.icon}</span>
                  <span>{card.label}</span>
                </button>
              ))}
            </div>

            {/* Quick rewrite bar */}
            <div style={{ marginTop: 24, padding: '12px 16px', background: 'rgba(0,0,0,.05)', border: '1.5px solid rgba(0,0,0,.12)', borderRadius: 12, width: '100%', maxWidth: 500 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--earth)', marginBottom: 8 }}>✨ Quick rewrite — paste any text, then:</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[
                  { label: '🎩 Make formal', prompt: 'Rewrite the following text in a formal, professional tone:\n\n' },
                  { label: '😊 Make casual', prompt: 'Rewrite the following text in a friendly, casual tone:\n\n' },
                  { label: '✏️ Fix grammar', prompt: 'Fix all grammar, spelling, and punctuation errors in the following text. Show the corrected version:\n\n' },
                  { label: '📐 Make shorter', prompt: 'Make the following text significantly shorter while keeping the key points:\n\n' },
                  { label: '🇪🇸 To Spanish', prompt: 'Translate the following text to Spanish:\n\n' },
                ].map((rw, i) => (
                  <button key={i} onClick={async () => {
                    try {
                      const clip = await navigator.clipboard?.readText();
                      if (clip) { setInput(rw.prompt + clip); setTimeout(() => inputRef.current?.focus(), 50); }
                      else { setInput(rw.prompt + '[paste your text here]'); inputRef.current?.focus(); }
                    } catch { setInput(rw.prompt + '[paste your text here]'); inputRef.current?.focus(); }
                  }}
                    style={{ padding: '6px 10px', border: '1px solid rgba(0,0,0,.12)', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: 'var(--text-dark)' }}
                  >{rw.label}</button>
                ))}
              </div>
            </div>
          </div>
        )}

        {!viewingMissionId && messages.map((msg, i) => (
          <div key={i} className={`chat-message ${msg.role}`}>
            <div className="chat-avatar">{msg.role === 'assistant' ? '' : ''}</div>
            <div className="chat-bubble">
              {msg.attachmentPreviews?.map((a, j) => (
                a.type === 'image'
                  ? <img key={j} src={a.preview} alt={a.name} style={{ maxWidth: 240, maxHeight: 180, borderRadius: 8, marginBottom: 8, display: 'block' }} />
                  : <div key={j} style={{ fontSize: 11, color: 'var(--text-light)', marginBottom: 6, padding: '4px 8px', background: 'rgba(0,0,0,.06)', borderRadius: 6 }}>📄 {a.name}</div>
              ))}
              {msg.role === 'assistant' && msg.trail && <ReasoningTrail steps={msg.trail} live={false} />}
              <MessageContent content={msg.content} onOpenArtifact={openArtifact} />
              {/* Message actions */}
              {msg.role === 'assistant' && !isStreaming && (
                <div style={{ display: 'flex', gap: 4, marginTop: 6, opacity: 0.4, transition: 'opacity .15s' }} onMouseEnter={e => e.currentTarget.style.opacity = 1} onMouseLeave={e => e.currentTarget.style.opacity = 0.4}>
                  <button onClick={() => navigator.clipboard?.writeText(msg.content)} title="Copy" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, padding: '2px 6px', borderRadius: 4, color: 'var(--text-light)' }}>📋</button>
                  {i === messages.length - 1 && (
                    <button onClick={() => {
                      setConversations(cs => cs.map(c => c.id === activeConvo ? { ...c, messages: c.messages.slice(0, -1) } : c));
                      setTimeout(() => {
                        const prev = messages[messages.length - 2];
                        if (prev?.role === 'user') { setInput(prev.content); }
                      }, 100);
                    }} title="Retry" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, padding: '2px 6px', borderRadius: 4, color: 'var(--text-light)' }}>🔄</button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {!viewingMissionId && (isStreaming || streamBuffer) && streamConvIdRef.current === activeConvo && (
          <div className="chat-message assistant">
            <div className="chat-avatar"></div>
            <div className="chat-bubble">
              {isStreaming && !streamBuffer ? (
                <ThinkingIndicator toolSteps={trail} />
              ) : (
                <>
                  <MessageContent content={streamBuffer || ''} onOpenArtifact={openArtifact} />
                  {isStreaming && (
                    <span style={{ display: 'inline-block', width: 6, height: 16, background: 'var(--text)', borderRadius: 2, animation: 'pulse 0.8s infinite', marginLeft: 2, verticalAlign: 'text-bottom' }} />
                  )}
                </>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
        {/* Scroll to bottom button */}
        {showScrollBtn && !isStreaming && (
          <button onClick={() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); setShowScrollBtn(false); }}
            style={{ position: 'sticky', bottom: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 10, background: 'var(--earth, #333)', color: '#fff', border: 'none', borderRadius: 20, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,.2)' }}>
            ↓ New messages
          </button>
        )}
      </div>

      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div style={{ padding: '8px 24px', display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: '1px solid rgba(0,0,0,.06)', background: 'rgba(245,166,35,.04)' }}>
          {attachments.map((a, i) => (
            <div key={i} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--cloud)', border: '1.5px solid rgba(0,0,0,.1)', borderRadius: 8, padding: '4px 8px', fontSize: 12 }}>
              {a.type === 'image'
                ? <img src={a.preview} alt={a.name} style={{ width: 32, height: 32, borderRadius: 4, objectFit: 'cover' }} />
                : <span>📄</span>}
              <span style={{ maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-mid)' }}>{a.name}</span>
              <button onClick={() => removeAttachment(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-light)', fontSize: 14, padding: 0, lineHeight: 1 }}>✕</button>
            </div>
          ))}
          {attachments.some((a) => a.type === 'image') && !hasVision && (
            <div style={{ fontSize: 11, color: 'var(--danger)', alignSelf: 'center' }}>⚠️ Switch to llava for image understanding</div>
          )}
        </div>
      )}

      {/* ── Voice Mode Overlay ── */}
      {voiceMode && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100,
          background: 'rgba(10,10,10,0.96)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 32,
        }}>
          {/* Animated orb */}
          <div style={{
            width: 120, height: 120, borderRadius: '50%',
            background: isSpeaking
              ? 'radial-gradient(circle, #171717 0%, rgba(0,0,0,0.3) 60%, transparent 100%)'
              : isListening
              ? 'radial-gradient(circle, #DC2626 0%, rgba(220,38,38,0.3) 60%, transparent 100%)'
              : 'radial-gradient(circle, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0.05) 60%, transparent 100%)',
            animation: (isSpeaking || isListening) ? 'voicePulse 1.5s ease-in-out infinite' : 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 48,
            boxShadow: isSpeaking ? '0 0 60px rgba(0,0,0,0.4)' : isListening ? '0 0 60px rgba(220,38,38,0.4)' : 'none',
            transition: 'all 0.5s ease',
          }}>
            {isSpeaking ? '🍃' : isListening ? '🎙' : '◦'}
          </div>

          <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.7)', fontSize: 16, fontFamily: 'var(--font-display)' }}>
            {isSpeaking ? 'Speaking…' : isListening ? 'Listening…' : 'Tap mic to speak'}
          </div>

          {/* Controls */}
          <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
            {!isSpeaking && (
              <button
                onClick={startListening}
                disabled={isListening}
                style={{
                  width: 64, height: 64, borderRadius: '50%', border: 'none', cursor: 'pointer',
                  background: isListening ? 'rgba(220,38,38,0.8)' : 'rgba(255,255,255,0.15)',
                  fontSize: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  animation: isListening ? 'voicePulse 1s infinite' : 'none',
                }}
              >
                🎙
              </button>
            )}
            {isSpeaking && (
              <button
                onClick={() => { tts.stop(); setIsSpeaking(false); setTimeout(startListening, 300); }}
                style={{ width: 64, height: 64, borderRadius: '50%', border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.15)', fontSize: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                ⏹
              </button>
            )}
            <button
              onClick={exitVoiceMode}
              style={{ width: 48, height: 48, borderRadius: '50%', border: '1.5px solid rgba(255,255,255,0.2)', cursor: 'pointer', background: 'transparent', fontSize: 20, color: 'rgba(255,255,255,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Input area */}
      {showVisionGate && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', margin: '0 auto .6rem', maxWidth: 720, padding: '.55rem .8rem', background: 'rgba(0,0,0,.08)', border: '1px solid rgba(0,0,0,.2)', borderRadius: 11, fontSize: '.83rem' }}>
          {pulling ? (
            <>
              <span style={{ flex: 1 }}>
                Downloading <strong>{pulling.model}</strong>… {pulling.percent != null ? `${pulling.percent}%` : (pulling.status || '')}
              </span>
              <button onClick={() => window.aspen?.ollama?.abortPull?.()} style={{ fontSize: '.78rem', padding: '.3rem .7rem', borderRadius: 8, border: '1px solid rgba(0,0,0,.2)', background: '#fff', cursor: 'pointer' }}>Cancel</button>
            </>
          ) : (
            <>
              <span style={{ flex: 1 }}>
                <strong>{activeModel}</strong> can't see images. Install a vision model to analyze this image — it runs fully on your machine.
              </span>
              <button onClick={pullVisionModel} style={{ flexShrink: 0, fontSize: '.78rem', fontWeight: 600, padding: '.3rem .7rem', borderRadius: 8, border: 'none', background: 'var(--gold,#171717)', color: '#fff', cursor: 'pointer' }}>
                Get vision model
              </button>
            </>
          )}
        </div>
      )}

      {showCodeTip && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', margin: '0 auto .6rem', maxWidth: 720, padding: '.55rem .8rem', background: 'rgba(0,0,0,.08)', border: '1px solid rgba(0,0,0,.2)', borderRadius: 11, fontSize: '.83rem' }}>
          <span style={{ flex: 1, color: 'var(--text,#1D1D1F)' }}>
            Working with code? Connect GitHub and Aspen can read and write your repos directly — just add a token.
          </span>
          <button onClick={() => { setPage('connectors'); }}
            style={{ flexShrink: 0, fontSize: '.78rem', fontWeight: 600, padding: '.3rem .7rem', borderRadius: 8, border: 'none', background: 'var(--gold,#171717)', color: '#fff', cursor: 'pointer' }}>
            Connect GitHub →
          </button>
          <button onClick={() => setCodeTipDismissed(true)} title="Dismiss"
            style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-light,#6E6E73)', fontSize: '1.1rem', lineHeight: 1, padding: '0 .2rem' }}>
            ×
          </button>
        </div>
      )}

      <div className="chat-input-area">
        {/* Connector quick-menu ("+") */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setConnMenuOpen((v) => !v)}
            title="Connectors"
            style={{ width: 40, height: 40, borderRadius: '50%', background: connMenuOpen ? 'var(--gold,#171717)' : 'rgba(0,0,0,.08)', color: connMenuOpen ? '#fff' : 'inherit', border: '1.5px solid rgba(0,0,0,.1)', cursor: 'pointer', fontSize: 22, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            +
          </button>
          {connMenuOpen && (
            <>
              <div onClick={() => setConnMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
              <div className="conn-menu" style={{ position: 'absolute', bottom: 50, left: 0, zIndex: 41, width: 280, background: 'var(--surface,#fff)', border: '1px solid var(--border,rgba(0,0,0,.1))', borderRadius: 14, boxShadow: '0 8px 30px rgba(0,0,0,.16)', padding: '.5rem', maxHeight: 360, overflowY: 'auto' }}>
                <div style={{ fontSize: '.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-light,#6E6E73)', padding: '.4rem .55rem' }}>Connectors</div>
                {connectorList.length === 0 && (
                  <div style={{ padding: '.55rem', fontSize: '.82rem', color: 'var(--text-light,#6E6E73)' }}>No connectors available.</div>
                )}
                {connectorList.map((c) => (
                  <button key={c.id} onClick={() => quickConnect(c)} disabled={connBusy === c.id}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.6rem', width: '100%', padding: '.55rem', border: 'none', background: 'none', borderRadius: 9, cursor: 'pointer', textAlign: 'left' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(0,0,0,.04)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'none'}>
                    <span style={{ fontSize: '.88rem', fontWeight: 500 }}>{c.label}</span>
                    <span style={{ fontSize: '.7rem', fontWeight: 600, color: c.connected ? '#0F6E56' : 'var(--text-light,#6E6E73)' }}>
                      {connBusy === c.id ? '…' : c.connected ? '● On' : (c.needsToken && !c.hasToken) ? 'Set up →' : 'Connect'}
                    </span>
                  </button>
                ))}
                <button onClick={() => { setConnMenuOpen(false); setPage('connectors'); }}
                  style={{ width: '100%', marginTop: '.35rem', padding: '.5rem', border: 'none', borderTop: '1px solid var(--border,rgba(0,0,0,.08))', background: 'none', cursor: 'pointer', fontSize: '.8rem', color: 'var(--gold,#171717)', fontWeight: 600 }}>
                  Manage all connectors
                </button>
              </div>
            </>
          )}
        </div>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.txt,.md,.js,.ts,.py,.json,.csv,.html,.css,.jsx,.tsx,.pdf,.docx,.xlsx,.xls"
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />

        {/* Attach button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={!activeModel}
          title="Attach file or image"
          style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(0,0,0,.08)', border: '1.5px solid rgba(0,0,0,.1)', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: activeModel ? 1 : 0.4 }}
        >
          📎
        </button>

        {/* Voice button — tap for STT, long press / hold for full voice mode */}
        {voiceSupported && (
          <button
            onClick={ttsDownloading ? undefined : (ttsReady ? enterVoiceMode : toggleVoice)}
            disabled={!activeModel || isStreaming}
            title={ttsDownloading ? `Downloading voice model ${ttsProgress}%` : ttsReady ? 'Voice conversation mode' : 'Voice input'}
            style={{
              width: 40, height: 40, borderRadius: '50%', border: 'none', cursor: 'pointer', fontSize: 18,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              background: isListening ? 'rgba(231,76,60,.15)' : ttsReady ? 'rgba(0,0,0,.15)' : 'rgba(0,0,0,.08)',
              animation: isListening ? 'pulse 1s infinite' : 'none',
              opacity: (activeModel && !isStreaming) ? 1 : 0.4,
              position: 'relative',
            }}
          >
            {ttsDownloading ? '⬇️' : ttsReady ? '🎙️' : '🎙️'}
            {ttsDownloading && (
              <span style={{ position: 'absolute', bottom: -16, left: '50%', transform: 'translateX(-50%)', fontSize: 9, color: 'var(--text-light)', whiteSpace: 'nowrap' }}>{ttsProgress}%</span>
            )}
          </button>
        )}

        <textarea
          ref={inputRef}
          className="chat-input"
          placeholder={isListening ? 'Listening...' : activeModel ? 'Type a message or use 🎙️...' : 'Install a model first →'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          rows={1}
          disabled={!activeModel}
        />

        {isStreaming ? (
          <button className="chat-send" onClick={stopStreaming} title="Stop">⏹</button>
        ) : (
          <button
            className="chat-send"
            onClick={sendMessage}
            disabled={(!input.trim() && attachments.length === 0) || !activeModel}
            title="Send"
          >
            🖌️
          </button>
        )}
      </div>
    </div>

      {/* Artifact side panel */}
      {artifact && (
        <div style={{ width: 'min(48%,640px)', flexShrink: 0, borderLeft: '1.5px solid rgba(0,0,0,.1)', display: 'flex', flexDirection: 'column', background: '#fff', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1.5px solid rgba(0,0,0,.1)', flexShrink: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 600, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {(artifact.lang || 'code').toUpperCase()} artifact
            </span>
            {RUNNABLE.includes(artifact.lang) && (
              <div style={{ display: 'flex', gap: 2, background: 'rgba(0,0,0,.05)', borderRadius: 8, padding: 2 }}>
                <button onClick={() => setArtifactTab('preview')} style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', border: 'none', borderRadius: 6, cursor: 'pointer', background: artifactTab === 'preview' ? '#fff' : 'transparent', color: artifactTab === 'preview' ? 'var(--earth)' : 'var(--text-light)' }}>Preview</button>
                <button onClick={() => setArtifactTab('code')} style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', border: 'none', borderRadius: 6, cursor: 'pointer', background: artifactTab === 'code' ? '#fff' : 'transparent', color: artifactTab === 'code' ? 'var(--earth)' : 'var(--text-light)' }}>Code</button>
              </div>
            )}
            <button onClick={async () => {
              const btn = document.activeElement;
              try {
                const res = await fetch(`http://127.0.0.1:4000/publish-artifact`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ html: artifact.code }),
                });
                const data = await res.json();
                if (data.id) {
                  const tunnelUrl = await bridge?.store?.get('tunnelUrl');
                  const url = (tunnelUrl || 'http://127.0.0.1:4000') + data.path;
                  await navigator.clipboard?.writeText(url);
                  if (btn) { btn.textContent = 'Link copied!'; setTimeout(() => { btn.textContent = 'Publish 🚀'; }, 2000); }
                }
              } catch { if (btn) { btn.textContent = 'Error'; setTimeout(() => { btn.textContent = 'Publish 🚀'; }, 2000); } }
            }} style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', border: 'none', borderRadius: 7, background: 'var(--gold)', color: '#fff', cursor: 'pointer' }}>Publish 🚀</button>
            <button onClick={() => { navigator.clipboard?.writeText(artifact.code); }} style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', border: '1.5px solid rgba(0,0,0,.12)', borderRadius: 7, background: '#fff', cursor: 'pointer' }}>Copy</button>
            <button onClick={() => setArtifact(null)} title="Close" style={{ width: 28, height: 28, border: 'none', background: 'none', cursor: 'pointer', fontSize: 15, color: 'var(--text-light)' }}>✕</button>
          </div>
          <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
            {(artifactTab === 'preview' && RUNNABLE.includes(artifact.lang)) ? (
              <iframe
                title="Preview"
                sandbox="allow-scripts"
                srcDoc={artifact.lang === 'svg'
                  ? `<!doctype html><meta charset="utf-8"><body style="margin:0;display:grid;place-items:center;min-height:100vh">${artifact.code}</body>`
                  : artifact.code}
                style={{ width: '100%', height: '100%', border: 'none', background: '#fff', display: 'block' }}
              />
            ) : (
              <pre style={{ margin: 0, padding: '1rem', fontSize: 13, lineHeight: 1.55, overflow: 'auto', height: '100%', boxSizing: 'border-box' }}><code>{artifact.code}</code></pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Safe Markdown rendering — no dangerouslySetInnerHTML ───
// Live / persisted reasoning trail — the accumulating list of agent steps
// (status + tool calls), matching the web/mobile surfaces. When `live` it shows
// expanded with a pulse; when finished it collapses to a clickable summary.
// Inline "thinking" indicator — a single animated line whose message changes as
// work progresses, instead of a static word or a stacked list. When real tool
// activity is happening it shows the live tool status (which changes as each tool
// fires); otherwise it cycles through evocative phrases so it always feels alive.
const THINKING_PHRASES = [
  'Thinking',
  'Working it through',
  'Gathering my thoughts',
  'Connecting the dots',
  'Putting it together',
  'Almost there',
];

function ThinkingIndicator({ toolSteps }) {
  const steps = toolSteps || [];
  const hasTools = steps.length > 0;
  const latest = hasTools ? steps[steps.length - 1].status : null;
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (hasTools) return; // real tool status drives the text — don't cycle over it
    const id = setInterval(() => setIdx((i) => (i + 1) % THINKING_PHRASES.length), 2500);
    return () => clearInterval(id);
  }, [hasTools]);

  // Strip any leading emoji/symbol (e.g. "⚡ ") so the text sits clean inline.
  const raw = hasTools ? latest : THINKING_PHRASES[idx];
  const text = ((raw || 'Thinking').replace(/^[^\p{L}\p{N}]+/u, '').trim()) || 'Thinking';

  return (
    <span className="aspen-thinking">
      <span className="aspen-thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span>
      <span key={text} className="aspen-thinking-text">{text}…</span>
    </span>
  );
}

function ReasoningTrail({ steps, live = false }) {
  const [open, setOpen] = useState(live);
  useEffect(() => { if (live) setOpen(true); }, [live]);
  if (!steps || steps.length === 0) return null;
  const last = steps[steps.length - 1];
  return (
    <div className="aspen-trail" style={{ marginBottom: 8, fontSize: 13, color: 'var(--text-light)' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-light)', padding: 0, font: 'inherit' }}
      >
        <span style={{ opacity: live ? 1 : 0.7 }}>
          {open
            ? `${live ? 'Working' : 'Reasoning'} · ${steps.length} step${steps.length > 1 ? 's' : ''}`
            : (live ? last.status : `Reasoning · ${steps.length} step${steps.length > 1 ? 's' : ''}`)}
        </span>
        <span style={{ fontSize: 10 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ marginTop: 6, paddingLeft: 10, borderLeft: '2px solid var(--border, #3a352f)', display: 'flex', flexDirection: 'column', gap: 3 }}>
          {steps.map((s, i) => (
            <div key={i} style={{ opacity: live && i === steps.length - 1 ? 1 : 0.65 }}>{s.status}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function MessageContent({ content, onOpenArtifact }) {
  if (!content) return null;
  const text = typeof content === 'string' ? content : String(content || '');

  // ── Thinking display: extract <think>...</think> blocks ──
  let thinkContent = null;
  let displayContent = text;
  const thinkMatch = text.match(/<think>([\s\S]*?)<\/think>/);
  if (thinkMatch) {
    thinkContent = (thinkMatch[1] || '').trim();
    displayContent = text.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
  }

  // ── Citations: detect [Source: url] or [1]: url patterns ──
  const citations = [];
  displayContent = displayContent.replace(/\[(?:Source|Ref|(\d+))\]:\s*(https?:\/\/\S+)/gi, (_, num, url) => {
    try {
      const domain = new URL(url).hostname.replace('www.', '');
      citations.push({ num: num || citations.length + 1, url, domain });
    } catch {}
    return '';
  });

  const parts = displayContent.split(/(```[\s\S]*?```)/g);
  return (
    <>
      {thinkContent && (
        <details style={{ marginBottom: 8, fontSize: 13, color: 'var(--text-light)' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 12, opacity: 0.7, marginBottom: 4 }}>💭 Thinking...</summary>
          <div style={{ padding: '8px 12px', background: 'rgba(0,0,0,.03)', borderRadius: 8, whiteSpace: 'pre-wrap', lineHeight: 1.5, fontStyle: 'italic' }}>{thinkContent}</div>
        </details>
      )}
      {parts.map((part, i) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          const lines = part.slice(3, -3).split('\n');
          const lang = lines[0]?.trim() || '';
          const code = lang ? lines.slice(1).join('\n') : lines.join('\n');
          // Mermaid diagram detection
          if (lang.toLowerCase() === 'mermaid') {
            return <div key={i} className="artifact" style={{ padding: '12px 16px' }}>
              <div className="artifact-head"><span className="artifact-lang">📊 Mermaid Diagram</span></div>
              <pre className="artifact-code" style={{ fontSize: 12 }}><code>{code}</code></pre>
            </div>;
          }
          return <CodeBlock key={i} lang={lang} code={code} onOpenArtifact={onOpenArtifact} />;
        }
        // Unclosed code fence (still streaming)
        if (part.includes('```')) {
          const fenceIdx = part.lastIndexOf('```');
          const before = part.slice(0, fenceIdx);
          const after = part.slice(fenceIdx + 3);
          const lines = after.split('\n');
          const lang = lines[0]?.trim() || '';
          const code = lang ? lines.slice(1).join('\n') : lines.join('\n');
          const norm = normLang(lang, code);
          return <React.Fragment key={i}>
            {before && <InlineText text={before} />}
            <div className="artifact" style={{ opacity: 0.85 }}>
              <div className="artifact-head">
                <span className="artifact-lang">{norm || 'code'} · generating...</span>
              </div>
              <pre className="artifact-code" style={{ maxHeight: 200, overflow: 'hidden' }}><code>{code.slice(-800)}</code></pre>
            </div>
          </React.Fragment>;
        }
        return <InlineText key={i} text={part} />;
      })}
      {citations.length > 0 && (
        <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(0,0,0,.03)', borderRadius: 8, fontSize: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-light)' }}>Sources:</div>
          {citations.map((c, i) => (
            <div key={i} style={{ marginBottom: 2 }}>
              <a href={c.url} target="_blank" rel="noopener" style={{ color: 'var(--gold)', textDecoration: 'none' }}>
                [{c.num}] {c.domain}
              </a>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function InlineText({ text }) {
  if (!text || typeof text !== 'string') return null;
  // Split on **bold**, `code`, $latex$, $$latex$$, URLs, headers, lists, blockquotes, HR, and newlines
  const lines = text.split('\n');
  const elements = [];
  let inList = false;
  let listItems = [];
  let inOrderedList = false;
  let orderedItems = [];
  let inTable = false;
  let tableRows = [];

  const flushList = () => { if (listItems.length) { elements.push(<ul key={`ul-${elements.length}`} style={{ margin: '8px 0', paddingLeft: 20 }}>{listItems.map((li, i) => <li key={i} style={{ marginBottom: 4 }}>{renderInline(li)}</li>)}</ul>); listItems = []; inList = false; } };
  const flushOrderedList = () => { if (orderedItems.length) { elements.push(<ol key={`ol-${elements.length}`} style={{ margin: '8px 0', paddingLeft: 20 }}>{orderedItems.map((li, i) => <li key={i} style={{ marginBottom: 4 }}>{renderInline(li)}</li>)}</ol>); orderedItems = []; inOrderedList = false; } };
  const flushTable = () => {
    if (tableRows.length) {
      const headers = tableRows[0];
      const body = tableRows.slice(2); // skip separator row
      elements.push(
        <div key={`tbl-${elements.length}`} style={{ overflowX: 'auto', margin: '8px 0' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr>{headers.map((h, i) => <th key={i} style={{ border: '1px solid rgba(0,0,0,.1)', padding: '6px 10px', background: 'rgba(0,0,0,.03)', fontWeight: 600, textAlign: 'left' }}>{renderInline(h.trim())}</th>)}</tr></thead>
            <tbody>{body.map((row, ri) => <tr key={ri}>{row.map((cell, ci) => <td key={ci} style={{ border: '1px solid rgba(0,0,0,.1)', padding: '6px 10px' }}>{renderInline(cell.trim())}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
      tableRows = []; inTable = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Table detection
    if (line.includes('|') && line.trim().startsWith('|')) {
      const cells = line.split('|').filter(Boolean);
      if (!inTable) { inTable = true; flushList(); flushOrderedList(); }
      tableRows.push(cells);
      continue;
    } else if (inTable) { flushTable(); }
    // Unordered list
    if (/^[\s]*[-*]\s/.test(line)) { flushOrderedList(); inList = true; listItems.push(line.replace(/^[\s]*[-*]\s/, '')); continue; }
    else if (inList) { flushList(); }
    // Ordered list
    if (/^[\s]*\d+\.\s/.test(line)) { flushList(); inOrderedList = true; orderedItems.push(line.replace(/^[\s]*\d+\.\s/, '')); continue; }
    else if (inOrderedList) { flushOrderedList(); }
    // Headers
    if (line.startsWith('### ')) { elements.push(<h4 key={`h-${i}`} style={{ fontSize: 14, fontWeight: 700, margin: '12px 0 4px', color: 'var(--earth)' }}>{renderInline(line.slice(4))}</h4>); continue; }
    if (line.startsWith('## ')) { elements.push(<h3 key={`h-${i}`} style={{ fontSize: 15, fontWeight: 700, margin: '14px 0 6px', color: 'var(--earth)' }}>{renderInline(line.slice(3))}</h3>); continue; }
    if (line.startsWith('# ')) { elements.push(<h2 key={`h-${i}`} style={{ fontSize: 17, fontWeight: 700, margin: '16px 0 8px', color: 'var(--earth)' }}>{renderInline(line.slice(2))}</h2>); continue; }
    // Blockquote
    if (line.startsWith('> ')) { elements.push(<blockquote key={`bq-${i}`} style={{ borderLeft: '3px solid var(--gold)', paddingLeft: 12, margin: '8px 0', color: 'var(--text-light)', fontStyle: 'italic' }}>{renderInline(line.slice(2))}</blockquote>); continue; }
    // Horizontal rule
    if (/^[-*_]{3,}$/.test(line.trim())) { elements.push(<hr key={`hr-${i}`} style={{ border: 'none', borderTop: '1px solid rgba(0,0,0,.1)', margin: '12px 0' }} />); continue; }
    // Empty line
    if (!line.trim()) { elements.push(<div key={`br-${i}`} style={{ height: 8 }} />); continue; }
    // Regular paragraph
    elements.push(<div key={`p-${i}`}>{renderInline(line)}</div>);
  }
  flushList(); flushOrderedList(); flushTable();
  return <>{elements}</>;
}

function renderInline(text) {
  if (!text) return null;
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\$\$[^$]+\$\$|\$[^$]+\$|https?:\/\/\S+|\[[^\]]+\]\([^)]+\))/g);
  return parts.filter(Boolean).map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith('`') && p.endsWith('`')) return <code key={i} style={{ background: 'rgba(0,0,0,.06)', padding: '1px 4px', borderRadius: 3, fontSize: '0.9em' }}>{p.slice(1, -1)}</code>;
    if (p.startsWith('$$') && p.endsWith('$$')) return <div key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: 13, background: 'rgba(0,0,0,.04)', padding: '8px 12px', borderRadius: 6, margin: '4px 0', textAlign: 'center', overflowX: 'auto' }}>{p.slice(2, -2)}</div>;
    if (p.startsWith('$') && p.endsWith('$') && p.length > 2) return <span key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: 13, background: 'rgba(0,0,0,.04)', padding: '1px 4px', borderRadius: 3 }}>{p.slice(1, -1)}</span>;
    if (p.match(/^\[([^\]]+)\]\(([^)]+)\)$/)) { const m = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/); return <a key={i} href={m[2]} target="_blank" rel="noopener" style={{ color: 'var(--gold)', textDecoration: 'underline' }}>{m[1]}</a>; }
    if (p.match(/^https?:\/\//)) return <a key={i} href={p} target="_blank" rel="noopener" style={{ color: 'var(--gold)', textDecoration: 'underline' }}>{p.length > 50 ? p.slice(0, 47) + '...' : p}</a>;
    return p;
  });
}

// ─── Code artifact card: opens in the side panel (Claude-style) ───
function normLang(lang, code) {
  let norm = (lang || '').toLowerCase();
  if (!norm || norm === 'text') {
    const head = (code || '').trimStart().slice(0, 200).toLowerCase();
    if (head.startsWith('<!doctype html') || head.startsWith('<html') || head.includes('<body')) norm = 'html';
    else if (head.startsWith('<svg')) norm = 'svg';
  }
  return norm;
}
function CodeBlock({ lang, code, onOpenArtifact }) {
  const [copied, setCopied] = useState(false);
  const norm = normLang(lang, code);
  const canPreview = RUNNABLE.includes(norm);
  // Auto-open image-only HTML artifacts (e.g. a fetched photo via find_image) so
  // "show me X" displays immediately instead of needing a click. Code/app artifacts
  // (which contain <script>) still open on demand.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current) return;
    if (norm === 'html' && /<img[\s>]/i.test(code) && !/<script/i.test(code)) {
      autoOpened.current = true;
      onOpenArtifact?.(code, norm);
    }
  }, [norm, code, onOpenArtifact]);

  function copy(e) {
    e.stopPropagation();
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }

  return (
    <div className="artifact" onClick={() => onOpenArtifact?.(code, norm)} style={{ cursor: 'pointer' }}>
      <div className="artifact-head">
        <span className="artifact-lang">{lang || norm || 'text'}</span>
        <div className="artifact-actions">
          <button className="artifact-btn" onClick={(e) => { e.stopPropagation(); onOpenArtifact?.(code, norm); }}>
            {canPreview ? 'Open ↗' : 'View ↗'}
          </button>
          <button className="artifact-btn" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
        </div>
      </div>
      <pre className="artifact-code"><code>{code}</code></pre>
    </div>
  );
}
