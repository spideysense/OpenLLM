import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../App';

export default function Chat() {
  const { bridge, activeModel, selectModel, models } = useApp();
  const [conversations, setConversations] = useState([{ id: 1, title: 'New Chat', messages: [] }]);
  const [activeConvo, setActiveConvo] = useState(1);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState('');
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const convo = conversations.find((c) => c.id === activeConvo);
  const messages = convo?.messages || [];

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamBuffer]);

  // Listen for stream chunks
  useEffect(() => {
    if (!bridge) return;
    const unsub = bridge.chat.onStream((chunk) => {
      if (chunk.done) {
        setIsStreaming(false);
        setStreamBuffer((buf) => {
          // Finalize the assistant message
          setConversations((prev) =>
            prev.map((c) =>
              c.id === activeConvo
                ? {
                    ...c,
                    messages: [...c.messages, { role: 'assistant', content: buf + chunk.content }],
                    title: c.messages.length === 0 ? (c.messages[0]?.content || 'Chat').slice(0, 40) : c.title,
                  }
                : c
            )
          );
          return '';
        });
      } else {
        setStreamBuffer((prev) => prev + chunk.content);
      }
    });
    return unsub;
  }, [bridge, activeConvo]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming || !activeModel) return;

    const userMsg = { role: 'user', content: text };
    const updatedMessages = [...messages, userMsg];

    // Update conversation
    setConversations((prev) =>
      prev.map((c) =>
        c.id === activeConvo
          ? {
              ...c,
              messages: updatedMessages,
              title: c.messages.length === 0 ? text.slice(0, 40) : c.title,
            }
          : c
      )
    );

    setInput('');
    setIsStreaming(true);
    setStreamBuffer('');

    if (bridge) {
      await bridge.chat.send(activeModel, updatedMessages);
    } else {
      // Mock for dev
      setTimeout(() => {
        setStreamBuffer("I'm a mock response! In the real app, I'd be powered by a local LLM running on your machine. 🐻");
        setIsStreaming(false);
        setConversations((prev) =>
          prev.map((c) =>
            c.id === activeConvo
              ? {
                  ...c,
                  messages: [
                    ...updatedMessages,
                    { role: 'assistant', content: "I'm a mock response! In the real app, I'd be powered by a local LLM running on your machine. 🐻" },
                  ],
                }
              : c
          )
        );
      }, 500);
    }
  }, [input, isStreaming, activeModel, messages, bridge, activeConvo]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const newConvo = () => {
    const id = Date.now();
    setConversations((prev) => [...prev, { id, title: 'New Chat', messages: [] }]);
    setActiveConvo(id);
  };

  const stopStreaming = () => {
    if (bridge) bridge.chat.stop();
    setIsStreaming(false);
  };

  return (
    <div className="chat-container">
      {/* Header */}
      <div className="chat-header">
        <span style={{ fontSize: 24 }}>🐻</span>
        <h2>Chat</h2>
        <div style={{ flex: 1 }} />

        {/* Model selector */}
        <select
          value={activeModel || ''}
          onChange={(e) => selectModel(e.target.value)}
          style={{
            padding: '6px 12px',
            borderRadius: 'var(--radius-pill)',
            border: '1.5px solid rgba(93,78,55,0.12)',
            fontFamily: 'var(--font-body)',
            fontSize: 13,
            fontWeight: 600,
            background: 'var(--cloud)',
            color: 'var(--earth)',
            cursor: 'pointer',
          }}
        >
          {models.length === 0 && <option value="">No models installed</option>}
          {models.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name} ({m.sizeGB} GB)
            </option>
          ))}
        </select>

        <button className="btn btn-sm btn-secondary" onClick={newConvo}>
          + New
        </button>
      </div>

      {/* Messages */}
      <div className="chat-messages">
        {messages.length === 0 && !streamBuffer && (
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 0.6,
          }}>
            <div style={{ fontSize: 64, marginBottom: 12 }}>🐻</div>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: 22,
              fontWeight: 700,
              color: 'var(--earth)',
              marginBottom: 6,
            }}>
              Ask me anything!
            </div>
            <div style={{ fontSize: 14, color: 'var(--text-light)', maxWidth: 300, textAlign: 'center', lineHeight: 1.5 }}>
              Everything stays on your machine. No data leaves this cave. 🐾
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`chat-message ${msg.role}`}>
            <div className="chat-avatar">
              {msg.role === 'assistant' ? '🐻' : '👤'}
            </div>
            <div className="chat-bubble">
              <MessageContent content={msg.content} />
            </div>
          </div>
        ))}

        {/* Streaming indicator */}
        {(isStreaming || streamBuffer) && (
          <div className="chat-message assistant">
            <div className="chat-avatar">🐻</div>
            <div className="chat-bubble">
              <MessageContent content={streamBuffer || ''} />
              {isStreaming && (
                <span style={{
                  display: 'inline-block',
                  width: 6,
                  height: 16,
                  background: 'var(--pipe-yellow)',
                  borderRadius: 2,
                  animation: 'pulse 0.8s infinite',
                  marginLeft: 2,
                  verticalAlign: 'text-bottom',
                }} />
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="chat-input-area">
        <textarea
          ref={inputRef}
          className="chat-input"
          placeholder={activeModel ? 'Type a message...' : 'Install a model first →'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={!activeModel}
        />
        {isStreaming ? (
          <button className="chat-send" onClick={stopStreaming} title="Stop">
            ⏹
          </button>
        ) : (
          <button
            className="chat-send"
            onClick={sendMessage}
            disabled={!input.trim() || !activeModel}
            title="Send"
          >
            🐾
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Simple Markdown-ish rendering ───
function MessageContent({ content }) {
  if (!content) return null;

  // Split by code blocks
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('```')) {
          const lines = part.slice(3, -3).split('\n');
          const lang = lines[0]?.trim() || '';
          const code = lang ? lines.slice(1).join('\n') : lines.join('\n');
          return (
            <pre key={i}>
              <code>{code}</code>
            </pre>
          );
        }

        // Process inline formatting
        return (
          <span key={i} dangerouslySetInnerHTML={{
            __html: part
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
              .replace(/`(.*?)`/g, '<code>$1</code>')
              .replace(/\n/g, '<br/>')
          }} />
        );
      })}
    </>
  );
}
