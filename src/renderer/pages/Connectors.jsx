import { useState, useEffect, useCallback } from 'react';

export default function Connectors() {
  const [connectors, setConnectors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);        // id currently connecting/disconnecting
  const [expanded, setExpanded] = useState(null); // id whose data-flow detail is open
  const [tokenFor, setTokenFor] = useState(null); // id whose token form is open
  const [tokenVal, setTokenVal] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const list = await window.aspen.connectors.list();
      setConnectors(list || []);
    } catch (e) {
      setError('Could not load connectors.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleConnect(id, token) {
    setBusy(id); setError('');
    try {
      const r = await window.aspen.connectors.connect(id, token);
      if (!r.ok) setError(r.error || 'Failed to connect.');
      else { setTokenFor(null); setTokenVal(''); }
      await refresh();
    } finally { setBusy(null); }
  }

  async function handleDisconnect(id) {
    setBusy(id); setError('');
    try { await window.aspen.connectors.disconnect(id); await refresh(); }
    finally { setBusy(null); }
  }

  async function handleRemoveToken(id) {
    setBusy(id); setError('');
    try { await window.aspen.connectors.removeToken(id); await refresh(); }
    finally { setBusy(null); }
  }

  if (loading) return <div className="page"><p className="muted">Loading connectors…</p></div>;

  return (
    <div className="page connectors-page">
      <h1>Connectors</h1>
      <p className="muted" style={{ marginBottom: '1.25rem' }}>
        Give Aspen the ability to use external tools. Aspen always tells you exactly
        where your data goes — what stays on your machine and what is sent out.
      </p>

      {error && <div className="connector-error">{error}</div>}

      <div className="connector-list">
        {connectors.map((c) => {
          const isLocal = c.dataFlow?.runsLocally;
          const isOpen = expanded === c.id;
          return (
            <div key={c.id} className="connector-card">
              <div className="connector-head">
                <div className="connector-title">
                  <span className="connector-name">{c.label}</span>
                  {c.connected
                    ? <span className="badge badge-on">Connected</span>
                    : <span className="badge badge-off">Not connected</span>}
                </div>
                <div className="connector-actions">
                  {c.connected ? (
                    <button className="btn btn-sm" disabled={busy === c.id}
                      onClick={() => handleDisconnect(c.id)}>
                      {busy === c.id ? '…' : 'Disconnect'}
                    </button>
                  ) : c.needsToken && !c.hasToken ? (
                    <button className="btn btn-sm btn-primary" disabled={busy === c.id}
                      onClick={() => { setTokenFor(tokenFor === c.id ? null : c.id); setTokenVal(''); }}>
                      Add token
                    </button>
                  ) : (
                    <button className="btn btn-sm btn-primary" disabled={busy === c.id}
                      onClick={() => handleConnect(c.id)}>
                      {busy === c.id ? 'Connecting…' : 'Connect'}
                    </button>
                  )}
                </div>
              </div>

              <p className="connector-desc">{c.description}</p>

              {/* Short privacy label — always visible */}
              <button
                className={`connector-privacy ${isLocal ? 'local' : 'cloud'}`}
                onClick={() => setExpanded(isOpen ? null : c.id)}
              >
                <span>{c.dataFlow?.shortLabel || (isLocal
                  ? '✓ Fully local — never leaves your machine'
                  : '⚠ Connects to an external service')}</span>
                <span className="connector-chevron">{isOpen ? '▾' : '▸'}</span>
              </button>

              {/* Full data-flow detail — on tap */}
              {isOpen && c.dataFlow && (
                <div className="connector-detail">
                  <div className="detail-row">
                    <span className="detail-k">What's sent</span>
                    <span className="detail-v">{c.dataFlow.sends || 'Nothing leaves your machine.'}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-k">What stays</span>
                    <span className="detail-v">{c.dataFlow.stays || 'Everything stays on this machine.'}</span>
                  </div>
                  {c.dataFlow.reachesOut && (
                    <div className="detail-row">
                      <span className="detail-k">Reaches out to</span>
                      <span className="detail-v">{c.dataFlow.reachesOut}</span>
                    </div>
                  )}
                  {c.dataFlow.note && <p className="detail-note">{c.dataFlow.note}</p>}
                </div>
              )}

              {/* Token entry form */}
              {tokenFor === c.id && (
                <div className="connector-token">
                  {c.tokenHelp && <p className="token-help">{c.tokenHelp}</p>}
                  <div className="token-row">
                    <input
                      type="password"
                      placeholder="Paste your token"
                      value={tokenVal}
                      onChange={(e) => setTokenVal(e.target.value)}
                      autoComplete="off"
                    />
                    <button className="btn btn-sm btn-primary"
                      disabled={!tokenVal.trim() || busy === c.id}
                      onClick={() => handleConnect(c.id, tokenVal.trim())}>
                      {busy === c.id ? 'Connecting…' : 'Save & Connect'}
                    </button>
                  </div>
                  <p className="token-note">
                    Your token is encrypted in your operating system's keychain. It never
                    touches Aspen's servers and is never stored in plaintext.
                  </p>
                </div>
              )}

              {/* Stored-token management */}
              {c.hasToken && !c.connected && tokenFor !== c.id && (
                <button className="connector-link" onClick={() => handleRemoveToken(c.id)}>
                  Remove saved token
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
