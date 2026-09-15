import React, { useState } from 'react';

export function Enrollment({ credential, request, verify, onConnected, onCancel }) {
  const [label, setLabel] = useState(''), [pending, setPending] = useState(null);
  const [saved, setSaved] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      if (!pending) setPending(await request(credential, { action: 'prepare', label }));
      else {
        try { await request(credential, { action: 'confirm', id: pending.id }); }
        catch (error) { if (!verify) throw error; await verify(pending.credential); }
        onConnected(pending.credential);
      }
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <section>
    <h1>{pending ? 'Keep your way back in.' : 'Make Aspen yours.'}</h1>
    {error && <p role="alert">{error}</p>}
    <form onSubmit={submit}>
      {!pending ? <>
        <p>Connect Aspen to your router and power. This setup creates your private household on this device.</p>
        <label>Your name<input value={label} onChange={e => setLabel(e.target.value)} required maxLength={100} autoComplete="given-name" /></label>
      </> : <>
        <p>Save this recovery code in your password manager or print it. It restores owner access if you lose a device. Anyone with it can become the household owner.</p>
        <textarea aria-label="Recovery code" value={pending.recovery} readOnly />
        <button type="button" onClick={() => {
          const url = URL.createObjectURL(new Blob([`Aspen recovery code\n\n${pending.recovery}\n\nKeep this private and separate from your Aspen.\n`], { type: 'text/plain' }));
          const a = document.createElement('a'); a.href = url; a.download = 'Aspen-recovery-code.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}>Save recovery code</button>
        <label><input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} /> I saved my recovery code somewhere safe</label>
        <p>Finishing setup replaces previous owner device credentials. Family members and their documents stay in place.</p>
      </>}
      <button disabled={busy || (!!pending && !saved)}>{busy ? 'Working…' : pending ? 'Finish setup' : 'Continue'}</button>
      <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
      {pending && <button type="button" disabled={busy} onClick={() => { setPending(null); setSaved(false); }}>Start again</button>}
    </form>
  </section>;
}
