import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useApp } from '../App';
import tts from '../lib/tts';

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
  const { bridge, activeModel, selectModel, models, setPage } = useApp();
  const [conversations, setConversations] = useState([{ id: 1, title: 'New Chat', messages: [] }]);
  const [activeConvo, setActiveConvo] = useState(1);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState('');
  const [attachments, setAttachments] = useState([]); // { type: 'image'|'text', name, data, preview }
  const [isListening, setIsListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [totalExchanges, setTotalExchanges] = useState(0);
  const [smallModelDismissed, setSmallModelDismissed] = useState(false);
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

  // Load saved conversations on mount
  useEffect(() => {
    if (!bridge?.conversations) return;
    bridge.conversations.load().then((saved) => {
      if (saved && saved.length > 0) {
        setConversations(saved);
        setActiveConvo(saved[saved.length - 1].id);
      }
    }).catch(() => {});
  }, [bridge]);

  // Save conversations whenever they change (debounced)
  useEffect(() => {
    if (!bridge?.conversations || conversations.length === 0) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      bridge.conversations.save(conversations).catch(() => {});
    }, 800);
    return () => clearTimeout(saveTimer.current);
  }, [bridge, conversations]);

  // Check voice support
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    setVoiceSupported(!!SR);
  }, []);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamBuffer]);

  // Stream chunks
  useEffect(() => {
    if (!bridge) return;
    const unsub = bridge.chat.onStream((chunk) => {
      if (chunk.done) {
        setIsStreaming(false);
        // Read the accumulated buffer via the functional updater, capture it,
        // commit the assistant message in the SAME pass, then clear. The old code
        // assigned finalContent inside the updater and read it in a setTimeout
        // before the updater had run → intermittent EMPTY assistant bubbles.
        setStreamBuffer((prev) => {
          const finalContent = prev + (chunk.content || '');
          setConversations((cs) =>
            cs.map((c) =>
              c.id === activeConvo
                ? {
                    ...c,
                    messages: [...c.messages, { role: 'assistant', content: finalContent }],
                    title: c.messages.length === 0 ? (c.messages[0]?.content || 'Chat').slice(0, 40) : c.title,
                  }
                : c
            )
          );
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
          return '';
        });

        setTotalExchanges((prev) => {
          const next = prev + 1;
          bridge?.store.set('totalExchanges', next).catch(() => {});
          return next;
        });
      } else {
        setStreamBuffer((prev) => prev + (chunk.content || ''));
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
    setIsStreaming(true);
    setStreamBuffer('');

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

  const newConvo = () => {
    const id = Date.now();
    const newC = { id, title: 'New Chat', messages: [] };
    setConversations((prev) => [...prev, newC]);
    setActiveConvo(id);
  };

  const deleteConvo = (id) => {
    setConversations((prev) => {
      const remaining = prev.filter((c) => c.id !== id);
      if (remaining.length === 0) {
        const fresh = { id: Date.now(), title: 'New Chat', messages: [] };
        setActiveConvo(fresh.id);
        return [fresh];
      }
      if (id === activeConvo) setActiveConvo(remaining[remaining.length - 1].id);
      return remaining;
    });
    bridge?.conversations.delete(id).catch(() => {});
  };

  const stopStreaming = () => {
    if (bridge) bridge.chat.stop();
    setIsStreaming(false);
  };

  const hasVision = isVisionModel(activeModel);

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Conversation history panel */}
      <div style={{
        width: 200, flexShrink: 0, borderRight: '1.5px solid rgba(93,78,55,.08)',
        display: 'flex', flexDirection: 'column', background: 'rgba(93,78,55,.02)', overflow: 'hidden',
      }}>
        <div style={{ padding: '12px 12px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: 1 }}>Chats</span>
          <button onClick={newConvo} style={{ background: 'var(--pipe-yellow)', border: 'none', borderRadius: 6, padding: '3px 8px', fontSize: 13, fontWeight: 700, cursor: 'pointer', color: 'var(--earth)' }}>+</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 6px 8px' }}>
          {[...conversations].reverse().map((c) => (
            <div
              key={c.id}
              style={{
                borderRadius: 8, padding: '7px 10px', marginBottom: 2, cursor: 'pointer',
                background: c.id === activeConvo ? 'rgba(245,166,35,.15)' : 'transparent',
                border: c.id === activeConvo ? '1.5px solid rgba(245,166,35,.3)' : '1.5px solid transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4,
              }}
              onClick={() => setActiveConvo(c.id)}
            >
              <span style={{ fontSize: 12, color: 'var(--text-mid)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, fontWeight: c.id === activeConvo ? 700 : 400 }}>
                {c.title || 'New Chat'}
              </span>
              {conversations.length > 1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); deleteConvo(c.id); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-light)', fontSize: 12, padding: '0 2px', lineHeight: 1, opacity: 0.5, flexShrink: 0 }}
                >✕</button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Main chat area */}
      <div className="chat-container" style={{ flex: 1, minWidth: 0 }}>
      {/* Header */}
      <div className="chat-header">
        <span style={{ fontSize: 24 }}>🌿</span>
        <h2>Chat</h2>

        {/* Savings counter */}
        {totalExchanges > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'rgba(123,198,126,0.12)', border: '1.5px solid rgba(74,166,81,0.2)',
            borderRadius: 'var(--radius-pill)', padding: '4px 12px',
            fontSize: 12, fontWeight: 700, color: 'var(--grass-dark)',
          }}>
            💰 ${moneySaved} saved vs Claude Opus
          </div>
        )}

        <div style={{ flex: 1 }} />

        <select
          value={activeModel || ''}
          onChange={(e) => selectModel(e.target.value)}
          style={{ padding: '6px 12px', borderRadius: 'var(--radius-pill)', border: '1.5px solid rgba(93,78,55,0.12)', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, background: 'var(--cloud)', color: 'var(--earth)', cursor: 'pointer' }}
        >
          {models.length === 0 && <option value="">No models installed</option>}
          {models.map((m) => (
            <option key={m.name} value={m.name}>{m.name}</option>
          ))}
        </select>

        <button className="btn btn-sm btn-secondary" onClick={newConvo} style={{ display: 'none' }}>+ New</button>
      </div>

      {/* Small model warning — dismissible */}
      {(() => {
        const m = (activeModel || '').toLowerCase();
        const isSmall = m.includes('e4b') || m.includes('e2b') || m.includes(':3b') || m.includes(':1b') || m.includes(':7b') || m.includes(':8b');
        if (!isSmall || smallModelDismissed) return null;
        return (
          <div style={{ margin: '0 24px', padding: '10px 14px', background: 'rgba(220,53,69,0.08)', border: '1px solid rgba(220,53,69,0.25)', borderRadius: 10, fontSize: 13, color: '#8b1a2b', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ flex: 1 }}>⚠️ <strong>{activeModel}</strong> is too small for reliable tool calling (web search, code execution). Switch to a 12B+ model for full capability.</span>
            <button onClick={() => setSmallModelDismissed(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#8b1a2b', padding: '0 4px' }}>✕</button>
          </div>
        );
      })()}

      {/* Messages */}
      <div className="chat-messages">
        {messages.length === 0 && !streamBuffer && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: 0.6 }}>
            <div style={{ fontSize: 64, marginBottom: 12 }}>🌿</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--earth)', marginBottom: 6 }}>Ask me anything</div>
            <div style={{ fontSize: 14, color: 'var(--text-light)', maxWidth: 300, textAlign: 'center', lineHeight: 1.5 }}>
              Everything stays on your machine. Your data, always private. 🌿
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`chat-message ${msg.role}`}>
            <div className="chat-avatar">{msg.role === 'assistant' ? '🌿' : '👤'}</div>
            <div className="chat-bubble">
              {msg.attachmentPreviews?.map((a, j) => (
                a.type === 'image'
                  ? <img key={j} src={a.preview} alt={a.name} style={{ maxWidth: 240, maxHeight: 180, borderRadius: 8, marginBottom: 8, display: 'block' }} />
                  : <div key={j} style={{ fontSize: 11, color: 'var(--text-light)', marginBottom: 6, padding: '4px 8px', background: 'rgba(93,78,55,.06)', borderRadius: 6 }}>📄 {a.name}</div>
              ))}
              <MessageContent content={msg.content} onOpenArtifact={openArtifact} />
            </div>
          </div>
        ))}

        {(isStreaming || streamBuffer) && (
          <div className="chat-message assistant">
            <div className="chat-avatar">🌿</div>
            <div className="chat-bubble">
              {isStreaming && !streamBuffer ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <svg viewBox="0 0 48 48" style={{ width: 22, height: 22, flexShrink: 0 }} aria-label="Thinking">
                    <path className="aspen-leaf" d="M24 6 C32 14, 38 22, 24 42 C10 22, 16 14, 24 6 Z" fill="#B8860B" fillOpacity="0" stroke="#B8860B" strokeWidth="1.6" strokeLinejoin="round" pathLength="1" />
                    <line className="aspen-stem" x1="24" y1="6" x2="24" y2="42" stroke="#B8860B" strokeWidth="1.1" strokeLinecap="round" pathLength="1" />
                  </svg>
                  <span className="aspen-tw" style={{ fontSize: 14, color: 'var(--text-light)' }}>Thinking</span>
                </span>
              ) : (
                <>
                  <MessageContent content={streamBuffer || ''} onOpenArtifact={openArtifact} />
                  {isStreaming && (
                    <span style={{ display: 'inline-block', width: 6, height: 16, background: 'var(--pipe-yellow)', borderRadius: 2, animation: 'pulse 0.8s infinite', marginLeft: 2, verticalAlign: 'text-bottom' }} />
                  )}
                </>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div style={{ padding: '8px 24px', display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: '1px solid rgba(93,78,55,.06)', background: 'rgba(245,166,35,.04)' }}>
          {attachments.map((a, i) => (
            <div key={i} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--cloud)', border: '1.5px solid rgba(93,78,55,.1)', borderRadius: 8, padding: '4px 8px', fontSize: 12 }}>
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
              ? 'radial-gradient(circle, #B8860B 0%, rgba(184,134,11,0.3) 60%, transparent 100%)'
              : isListening
              ? 'radial-gradient(circle, #DC2626 0%, rgba(220,38,38,0.3) 60%, transparent 100%)'
              : 'radial-gradient(circle, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0.05) 60%, transparent 100%)',
            animation: (isSpeaking || isListening) ? 'voicePulse 1.5s ease-in-out infinite' : 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 48,
            boxShadow: isSpeaking ? '0 0 60px rgba(184,134,11,0.4)' : isListening ? '0 0 60px rgba(220,38,38,0.4)' : 'none',
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', margin: '0 auto .6rem', maxWidth: 720, padding: '.55rem .8rem', background: 'rgba(184,134,11,.08)', border: '1px solid rgba(184,134,11,.2)', borderRadius: 11, fontSize: '.83rem' }}>
          {pulling ? (
            <>
              <span style={{ flex: 1 }}>
                Downloading <strong>{pulling.model}</strong>… {pulling.percent != null ? `${pulling.percent}%` : (pulling.status || '')}
              </span>
              <button onClick={() => window.aspen?.ollama?.abortPull?.()} style={{ fontSize: '.78rem', padding: '.3rem .7rem', borderRadius: 8, border: '1px solid rgba(93,78,55,.2)', background: '#fff', cursor: 'pointer' }}>Cancel</button>
            </>
          ) : (
            <>
              <span style={{ flex: 1 }}>
                <strong>{activeModel}</strong> can't see images. Install a vision model to analyze this image — it runs fully on your machine.
              </span>
              <button onClick={pullVisionModel} style={{ flexShrink: 0, fontSize: '.78rem', fontWeight: 600, padding: '.3rem .7rem', borderRadius: 8, border: 'none', background: 'var(--gold,#B8860B)', color: '#fff', cursor: 'pointer' }}>
                Get vision model
              </button>
            </>
          )}
        </div>
      )}

      {showCodeTip && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', margin: '0 auto .6rem', maxWidth: 720, padding: '.55rem .8rem', background: 'rgba(184,134,11,.08)', border: '1px solid rgba(184,134,11,.2)', borderRadius: 11, fontSize: '.83rem' }}>
          <span style={{ flex: 1, color: 'var(--text,#1D1D1F)' }}>
            Working with code? Connect GitHub and Aspen can read and write your repos directly — just add a token.
          </span>
          <button onClick={() => { setPage('connectors'); }}
            style={{ flexShrink: 0, fontSize: '.78rem', fontWeight: 600, padding: '.3rem .7rem', borderRadius: 8, border: 'none', background: 'var(--gold,#B8860B)', color: '#fff', cursor: 'pointer' }}>
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
            style={{ width: 40, height: 40, borderRadius: '50%', background: connMenuOpen ? 'var(--gold,#B8860B)' : 'rgba(93,78,55,.08)', color: connMenuOpen ? '#fff' : 'inherit', border: '1.5px solid rgba(93,78,55,.1)', cursor: 'pointer', fontSize: 22, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
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
                  style={{ width: '100%', marginTop: '.35rem', padding: '.5rem', border: 'none', borderTop: '1px solid var(--border,rgba(0,0,0,.08))', background: 'none', cursor: 'pointer', fontSize: '.8rem', color: 'var(--gold,#B8860B)', fontWeight: 600 }}>
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
          style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(93,78,55,.08)', border: '1.5px solid rgba(93,78,55,.1)', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: activeModel ? 1 : 0.4 }}
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
              background: isListening ? 'rgba(231,76,60,.15)' : ttsReady ? 'rgba(93,78,55,.15)' : 'rgba(93,78,55,.08)',
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
        <div style={{ width: 'min(48%,640px)', flexShrink: 0, borderLeft: '1.5px solid rgba(93,78,55,.1)', display: 'flex', flexDirection: 'column', background: '#fff', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1.5px solid rgba(93,78,55,.1)', flexShrink: 0 }}>
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
            <button onClick={() => { navigator.clipboard?.writeText(artifact.code); }} style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', border: '1.5px solid rgba(93,78,55,.12)', borderRadius: 7, background: '#fff', cursor: 'pointer' }}>Copy</button>
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
function MessageContent({ content, onOpenArtifact }) {
  if (!content) return null;
  const parts = content.split(/(```[\s\S]*?```)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          const lines = part.slice(3, -3).split('\n');
          const lang = lines[0]?.trim() || '';
          const code = lang ? lines.slice(1).join('\n') : lines.join('\n');
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
        // Parse inline formatting into React elements (no dangerouslySetInnerHTML)
        return <InlineText key={i} text={part} />;
      })}
    </>
  );
}

function InlineText({ text }) {
  // Split on **bold** and `code` markers, render as React elements
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\n)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
        if (p.startsWith('`') && p.endsWith('`')) return <code key={i}>{p.slice(1, -1)}</code>;
        if (p === '\n') return <br key={i} />;
        return p;
      })}
    </>
  );
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
