import React, { useState, useCallback, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { VaultPane } from '../shared-ui/VaultPane';
import { secureFetch } from '../../shared/secure-fetch';
import './style.css';

function Household() {
  const [secret, setSecret] = useState(''),
    [key, setKey] = useState(''),
    [page, setPage] = useState('vault');
  const [people, setPeople] = useState([]),
    [invite, setInvite] = useState(null),
    [name, setName] = useState('');
  const [error, setError] = useState(''),
    [model, setModel] = useState(''),
    [owner, setOwner] = useState(false);
  const [prompt, setPrompt] = useState(''),
    [messages, setMessages] = useState([]),
    [busy, setBusy] = useState(false);
  const controller = useRef(null),
    sessionVersion = useRef(0);
  const [modelStatus, setModelStatus] = useState(null);
  const api = useCallback(
    async (path, body, method = 'POST', token = key) => {
      const response = await secureFetch(location.origin, token, path, { method, body });
      const value = await response.json();
      if (!response.ok)
        throw new Error(
          value.error?.message || value.error || 'Aspen could not complete this request'
        );
      return value;
    },
    [key]
  );
  const request = useCallback((body) => api('/v1/vault', body), [api]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!key || !owner) return;
    let cancelled = false;
    const timer = setInterval(() => {
      api('/v1/household', undefined, 'GET')
        .then((info) => {
          if (!cancelled) {
            setModel(info.model || '');
            setModelStatus(info.modelStatus);
          }
        })
        .catch(() => {});
    }, 10000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [api, key, owner]);
  async function signIn(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/v1/vault', undefined, 'GET', secret);
      let info;
      try {
        info = await api('/v1/household', undefined, 'GET', secret);
      } catch {
        /* family members manage their own vault */
      }
      sessionVersion.current++;
      setModelStatus(info?.modelStatus || null);
      setOwner(!!info);
      setPeople(info?.people || []);
      setModel(info?.model || '');
      setKey(secret);
      setSecret('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function chat(e) {
    e.preventDefault();
    if (busy || !prompt.trim()) return;
    const next = [...messages, { role: 'user', content: prompt }];
    setMessages([...next, { role: 'assistant', content: '' }]);
    setPrompt('');
    setBusy(true);
    setError('');
    const ctrl = new AbortController();
    controller.current = ctrl;
    const session = sessionVersion.current;
    let output = '';
    try {
      const response = await secureFetch(location.origin, key, '/v1/agent', {
        method: 'POST',
        body: { messages: next, ...(model ? { model } : {}), stream: true },
        signal: ctrl.signal,
      });
      if (!response.ok)
        throw new Error((await response.json()).error || 'The local model is unavailable');
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ') || line.slice(6).trim() === '[DONE]') continue;
          const event = JSON.parse(line.slice(6));
          if (event.error)
            throw new Error(typeof event.error === 'string' ? event.error : event.error.message);
          output += event.choices?.[0]?.delta?.content || '';
          if (session !== sessionVersion.current) return;
          setMessages([...next, { role: 'assistant', content: output }]);
        }
      }
    } catch (e) {
      if (session === sessionVersion.current)
        setError(
          ctrl.signal.aborted
            ? 'Stopped. Review any actions already completed before retrying.'
            : e.message
        );
    } finally {
      if (session === sessionVersion.current) {
        setBusy(false);
        controller.current = null;
      }
    }
  }
  return (
    <main>
      <header>
        <strong>Aspen</strong>
        <span>Your household, on your hardware.</span>
        {key && (
          <button
            onClick={() => {
              sessionVersion.current++;
              controller.current?.abort();
              setBusy(false);
              setKey('');
              setMessages([]);
              setInvite(null);
              setPeople([]);
              setError('');
            }}
          >
            Lock
          </button>
        )}
      </header>
      {error && <p role="alert">{error}</p>}
      {!key ? (
        <section>
          <h1>Welcome home.</h1>
          <p>
            Use your household pairing credential to open your private Aspen. It stays in this tab’s
            memory and is cleared when you lock or close the page.
          </p>
          <form onSubmit={signIn}>
            <label>
              Pairing credential{' '}
              <input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                required
                autoComplete="off"
              />
            </label>
            <button disabled={busy}>{busy ? 'Connecting…' : 'Open my Aspen'}</button>
          </form>
          {!globalThis.crypto?.subtle && (
            <p role="alert">Open this page through HTTPS, or on localhost at your appliance.</p>
          )}
        </section>
      ) : (
        <>
          {modelStatus && modelStatus.state !== 'ready' && (
            <p role="status">
              Local model: {modelStatus.state.replaceAll('-', ' ')}. {modelStatus.detail}
            </p>
          )}
          <nav>
            <button onClick={() => setPage('vault')}>Vault</button>
            <button onClick={() => setPage('chat')}>Chat</button>
            {owner && <button onClick={() => setPage('family')}>Family</button>}
          </nav>
          {page === 'vault' && <VaultPane request={request} people={people} />}
          {page === 'chat' && (
            <section>
              <h1>Ask Aspen</h1>
              <p>
                Your conversation uses the local model. Enabled network tools may send information
                to outside services. This browser conversation lasts until you lock or close this
                page.
              </p>
              {messages.map((m, i) => (
                <article key={i}>
                  <strong>{m.role === 'user' ? 'You' : 'Aspen'}</strong>
                  <p className="message">{m.content}</p>
                </article>
              ))}
              <form onSubmit={chat}>
                <label>
                  Your message{' '}
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    required
                    maxLength={20000}
                  />
                </label>
                <button disabled={busy || !prompt.trim()}>Send</button>
                {busy && (
                  <button type="button" onClick={() => controller.current?.abort()}>
                    Stop
                  </button>
                )}
              </form>
            </section>
          )}
          {page === 'family' && owner && (
            <section>
              <h1>Your family</h1>
              <p>
                Each new pairing gets its own private vault and memory identity. Share the
                credential directly with that person.
              </p>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setError('');
                  setBusy(true);
                  try {
                    setInvite(
                      await api('/v1/household', { action: 'invite', label: name, memory: true })
                    );
                    setPeople((await api('/v1/household', undefined, 'GET')).people);
                    setName('');
                  } catch (e) {
                    setError(e.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label>
                  Name{' '}
                  <input
                    value={name}
                    maxLength={100}
                    required
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <button disabled={busy}>Invite family member</button>
              </form>
              {invite && (
                <aside>
                  <p>Pairing for {invite.label}</p>
                  <textarea readOnly aria-label="Family pairing credential" value={invite.secret} />
                  <button onClick={() => setInvite(null)}>Hide</button>
                </aside>
              )}
              {people.map((p) => (
                <p key={p.id}>
                  {p.label}
                  {p.owner ? (
                    ' · Owner'
                  ) : (
                    <button
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await api('/v1/household', { action: 'revoke', id: p.id });
                          setPeople((await api('/v1/household', undefined, 'GET')).people);
                          if (invite?.id === p.id) setInvite(null);
                        } catch (e) {
                          setError(e.message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Revoke access
                    </button>
                  )}
                </p>
              ))}
            </section>
          )}
        </>
      )}
    </main>
  );
}
createRoot(document.getElementById('root')).render(<Household />);
