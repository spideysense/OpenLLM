import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../App';

// ── Savings counter ──
// Based on Claude Opus 4 API pricing: $15/M input tokens, $75/M output tokens
// Avg per exchange: ~200 input tokens + ~500 output tokens ≈ $0.04/exchange
const COST_PER_EXCHANGE = 0.040;
const VISION_MODELS = ['llava', 'llava-llama3', 'moondream', 'bakllava', 'llava-phi3'];

function isVisionModel(modelName) {
  if (!modelName) return false;
  return VISION_MODELS.some((v) => modelName.toLowerCase().includes(v));
}

export default function Chat() {
  const { bridge, activeModel, selectModel, models } = useApp();
  const [conversations, setConversations] = useState([{ id: 1, title: 'New Chat', messages: [] }]);
  const [activeConvo, setActiveConvo] = useState(1);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState('');
  const [attachments, setAttachments] = useState([]); // { type: 'image'|'text', name, data, preview }
  const [isListening, setIsListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [totalExchanges, setTotalExchanges] = useState(0);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const recognitionRef = useRef(null);
  const saveTimer = useRef(null);

  // Load saved exchange count
  useEffect(() => {
    if (!bridge) return;
    bridge.store.get('totalExchanges').then((n) => setTotalExchanges(n || 0)).catch(() => {});
  }, [bridge]);

  const convo = conversations.find((c) => c.id === activeConvo);
  const messages = convo?.messages || [];
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
  const saveTimer = useRef(null);
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
        setStreamBuffer((buf) => {
          const finalContent = buf + (chunk.content || '');
          setConversations((prev) =>
            prev.map((c) =>
              c.id === activeConvo
                ? {
                    ...c,
                    messages: [...c.messages, { role: 'assistant', content: finalContent }],
                    title: c.messages.length === 0 ? (c.messages[0]?.content || 'Chat').slice(0, 40) : c.title,
                  }
                : c
            )
          );
          return '';
        });
        // Increment savings counter
        setTotalExchanges((prev) => {
          const next = prev + 1;
          bridge?.store.set('totalExchanges', next).catch(() => {});
          return next;
        });
      } else {
        setStreamBuffer((prev) => prev + chunk.content);
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

  // ── File Attachments ──
  const handleFileSelect = useCallback(async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    const newAttachments = await Promise.all(files.map((file) => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        const isImage = file.type.startsWith('image/');

        if (isImage) {
          reader.onload = (ev) => {
            const base64 = ev.target.result.split(',')[1]; // strip data:image/...;base64,
            resolve({ type: 'image', name: file.name, data: base64, preview: ev.target.result });
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
        <span style={{ fontSize: 24 }}>🎨</span>
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

      {/* Messages */}
      <div className="chat-messages">
        {messages.length === 0 && !streamBuffer && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: 0.6 }}>
            <div style={{ fontSize: 64, marginBottom: 12 }}>🎨</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--earth)', marginBottom: 6 }}>Ask Monet anything!</div>
            <div style={{ fontSize: 14, color: 'var(--text-light)', maxWidth: 300, textAlign: 'center', lineHeight: 1.5 }}>
              Everything stays on your machine. Your data, always private. 🎨
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`chat-message ${msg.role}`}>
            <div className="chat-avatar">{msg.role === 'assistant' ? '🎨' : '👤'}</div>
            <div className="chat-bubble">
              {msg.attachmentPreviews?.map((a, j) => (
                a.type === 'image'
                  ? <img key={j} src={a.preview} alt={a.name} style={{ maxWidth: 240, maxHeight: 180, borderRadius: 8, marginBottom: 8, display: 'block' }} />
                  : <div key={j} style={{ fontSize: 11, color: 'var(--text-light)', marginBottom: 6, padding: '4px 8px', background: 'rgba(93,78,55,.06)', borderRadius: 6 }}>📄 {a.name}</div>
              ))}
              <MessageContent content={msg.content} />
            </div>
          </div>
        ))}

        {(isStreaming || streamBuffer) && (
          <div className="chat-message assistant">
            <div className="chat-avatar">🎨</div>
            <div className="chat-bubble">
              <MessageContent content={streamBuffer || ''} />
              {isStreaming && (
                <span style={{ display: 'inline-block', width: 6, height: 16, background: 'var(--pipe-yellow)', borderRadius: 2, animation: 'pulse 0.8s infinite', marginLeft: 2, verticalAlign: 'text-bottom' }} />
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

      {/* Input area */}
      <div className="chat-input-area">
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.txt,.md,.js,.ts,.py,.json,.csv,.html,.css,.jsx,.tsx"
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

        {/* Voice button */}
        {voiceSupported && (
          <button
            onClick={toggleVoice}
            disabled={!activeModel || isStreaming}
            title={isListening ? 'Stop listening' : 'Voice input'}
            style={{
              width: 40, height: 40, borderRadius: '50%', border: 'none', cursor: 'pointer', fontSize: 18,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              background: isListening ? 'rgba(231,76,60,.15)' : 'rgba(93,78,55,.08)',
              animation: isListening ? 'pulse 1s infinite' : 'none',
              opacity: (activeModel && !isStreaming) ? 1 : 0.4,
            }}
          >
            {isListening ? '🔴' : '🎙️'}
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
    </div>
  );
}

// ─── Safe Markdown rendering — no dangerouslySetInnerHTML ───
function MessageContent({ content }) {
  if (!content) return null;
  const parts = content.split(/(```[\s\S]*?```)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('```')) {
          const lines = part.slice(3, -3).split('\n');
          const lang = lines[0]?.trim() || '';
          const code = lang ? lines.slice(1).join('\n') : lines.join('\n');
          return <pre key={i}><code>{code}</code></pre>;
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
