import React, { useCallback, useEffect, useState } from 'react';
import { DocumentBackup } from './DocumentBackup';
export function VaultPane({ request, people = [] }) {
  const [data, setData] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(''),
    [results, setResults] = useState([]),
    [selected, setSelected] = useState([]);
  const [audience, setAudience] = useState(''),
    [purpose, setPurpose] = useState(''),
    [credential, setCredential] = useState(null);
  const refresh = useCallback(async () => setData(await request({ action: 'list' })), [request]);
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, [refresh]);
  async function act(fn) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(file) {
    if (!file) return;
    await act(async () => {
      if (file.size > 4 * 1024 * 1024) throw new Error('Choose a file up to 4 MB.');
      const base64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result.split(',')[1]);
        r.onerror = () => reject(new Error('Could not read this file'));
        r.readAsDataURL(file);
      });
      await request({ action: 'import', name: file.name, base64 });
    });
  }
  async function download(id) {
    const doc = await request({ action: 'download', id });
    const bytes = Uint8Array.from(atob(doc.base64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = doc.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="vault-pane" aria-label="Document vault">
      <h1>Your household vault</h1>
      <p>
        Files stay on this Aspen. Each person controls their own documents. Sharing is explicit.
      </p>
      {error && <p role="alert">{error}</p>}
      {!data ? (
        <p>Opening vault…</p>
      ) : (
        <>
          <DocumentBackup request={request} data={data} onRestored={refresh} />
          {!data.status.encrypted && (
            <p role="alert">
              Unlock your operating system’s secure storage before importing. Appliance
              installations need their encryption credential.
            </p>
          )}
          <label>
            Add a document{' '}
            <input
              type="file"
              accept=".txt,.md,.csv,.json,.pdf,.docx,.xlsx,.xls"
              disabled={busy || !data.status.encrypted}
              onChange={(e) => {
                upload(e.target.files[0]);
                e.target.value = '';
              }}
            />
          </label>
          <p>
            <small>
              Up to 4 MB per file, 1,000 documents and 256 MB total. Text search indexes the first
              100,000 characters; originals are kept intact.
            </small>
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              act(async () => setResults(await request({ action: 'search', query })));
            }}
          >
            <label>
              Search your documents{' '}
              <input
                value={query}
                maxLength={1000}
                onChange={(e) => setQuery(e.target.value)}
                required
              />
            </label>{' '}
            <button disabled={busy}>Search</button>
          </form>
          {results.map((r) => (
            <article key={r.documentId}>
              <strong>{r.name}</strong>
              <p>{r.snippet}</p>
              <small>
                Characters {r.start}–{r.end} · {r.documentId}
              </small>
            </article>
          ))}
          {!data.documents.length && <p>No documents yet. Add a file to start.</p>}
          {data.documents.map((doc) => (
            <article key={doc.id}>
              <label>
                <input
                  type="checkbox"
                  disabled={doc.owner !== data.person || busy}
                  checked={selected.includes(doc.id)}
                  onChange={(e) =>
                    setSelected((s) =>
                      e.target.checked ? [...s, doc.id] : s.filter((id) => id !== doc.id)
                    )
                  }
                />{' '}
                <strong>{doc.name}</strong>
              </label>
              <p>
                {(doc.size / 1024).toFixed(1)} KB ·{' '}
                {doc.owner === data.person ? 'Yours' : 'Shared with you'}
                {doc.truncated ? ' · Search covers the first 100,000 characters' : ''}
              </p>
              <button disabled={busy} onClick={() => act(() => download(doc.id))}>
                Download original
              </button>
              {doc.owner === data.person && (
                <>
                  <label>
                    {' '}
                    Keep for{' '}
                    <select
                      disabled={busy}
                      value={doc.expiresAt ? 'custom' : '0'}
                      onChange={(e) =>
                        act(() =>
                          request({
                            action: 'update',
                            id: doc.id,
                            retentionDays: Number(e.target.value),
                          })
                        )
                      }
                    >
                      <option value="0">Until I delete it</option>
                      {doc.expiresAt && (
                        <option value="custom">
                          Until {new Date(doc.expiresAt).toLocaleDateString()}
                        </option>
                      )}
                      <option value="30">30 days from now</option>
                      <option value="365">1 year from now</option>
                    </select>
                  </label>
                  <fieldset disabled={busy}>
                    <legend>Share with family</legend>
                    {(data.people || people)
                      .filter((p) => p.userId !== data.person)
                      .map((p) => (
                        <label key={p.id}>
                          <input
                            type="checkbox"
                            checked={doc.sharedWith.includes(p.userId || p.id)}
                            onChange={(e) =>
                              act(() =>
                                request({
                                  action: 'update',
                                  id: doc.id,
                                  sharedWith: e.target.checked
                                    ? [...doc.sharedWith, p.userId || p.id]
                                    : doc.sharedWith.filter((id) => id !== (p.userId || p.id)),
                                })
                              )
                            }
                          />
                          {p.label}{' '}
                        </label>
                      ))}
                    {!(data.people || people).some((p) => p.userId !== data.person) && (
                      <small>Invite family from the household owner’s settings first.</small>
                    )}
                  </fieldset>
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete ${doc.name}? This removes its original and search content from this Aspen. Copies in exported backups remain.`
                        )
                      )
                        act(async () => {
                          await request({ action: 'delete', id: doc.id });
                          setSelected((s) => s.filter((id) => id !== doc.id));
                          setResults((s) => s.filter((r) => r.documentId !== doc.id));
                        });
                    }}
                  >
                    Delete document
                  </button>
                </>
              )}
            </article>
          ))}
          <h2>Share limited context with an external model</h2>
          <p>
            Select documents you own above. A grant permits up to 20 searches, at most 2,000 excerpt
            characters each, for one hour. The recipient can retain what you share. The recipient
            name is an audit label; anyone holding the credential can use it.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              act(async () =>
                setCredential(
                  await request({ action: 'grant', documentIds: selected, audience, purpose })
                )
              );
            }}
          >
            <label>
              Recipient{' '}
              <input
                value={audience}
                maxLength={200}
                required
                onChange={(e) => setAudience(e.target.value)}
                placeholder="My frontier model integration"
              />
            </label>
            <label>
              Purpose{' '}
              <input
                value={purpose}
                maxLength={200}
                required
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="Help compare these home repair quotes"
              />
            </label>
            <button disabled={busy || !selected.length}>Create limited context credential</button>
          </form>
          {credential && (
            <aside>
              <p>
                Copy this credential into your integration. It can only retrieve excerpts from the
                documents you selected.
              </p>
              <textarea aria-label="Context credential" readOnly value={credential.token} />
              <p>Expires {new Date(credential.expiresAt).toLocaleString()}</p>
              <button onClick={() => setCredential(null)}>Hide credential</button>
            </aside>
          )}
          {data.grants
            .filter((g) => !g.revoked && g.expiresAt > Date.now())
            .map((g) => (
              <p key={g.id}>
                {g.audience}: {g.used}/{g.maxRequests} searches · {g.purpose}{' '}
                <button
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      await request({ action: 'revoke', id: g.id });
                      if (credential?.id === g.id) setCredential(null);
                    })
                  }
                >
                  Revoke
                </button>
              </p>
            ))}
          <details>
            <summary>Recent vault activity</summary>
            {data.activity.map((a) => (
              <p key={a.id}>
                {new Date(a.at).toLocaleString()} · {a.action}
                {a.audience ? ` · ${a.audience}` : ''}
                {a.characters != null ? ` · ${a.characters} characters shared` : ''}
              </p>
            ))}
          </details>
        </>
      )}
    </section>
  );
}
