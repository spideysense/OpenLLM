import React, { useState } from 'react';
import { encryptDocuments, decryptDocuments } from '../../shared/document-backup';

export function DocumentBackup({ request, data, onRestored }) {
  const [password, setPassword] = useState(''), [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [error, setError] = useState('');
  const owned = data.documents.filter(d => d.owner === data.person);
  async function save() {
    setError(''); setBusy(true);
    try {
      if (password !== repeat) throw new Error('Passwords do not match');
      if (password.length < 12) throw new Error('Use at least 12 characters');
      const files = [];
      for (const doc of owned) {
        setStatus(`Preparing document ${files.length + 1} of ${owned.length}…`);
        const original = await request({ action: 'download', id: doc.id });
        files.push({ name: original.name, base64: original.base64, sha256: original.sha256 });
      }
      setStatus('Encrypting your backup…');
      const raw = await encryptDocuments(files, password);
      const url = URL.createObjectURL(new Blob([raw], { type: 'application/octet-stream' }));
      const a = document.createElement('a'); a.href = url; a.download = 'Aspen-documents.aspendocs'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setPassword(''); setRepeat(''); setStatus('Encrypted backup downloaded. Keep it off this Aspen, with its password saved separately.');
    } catch (e) { setError(e.message); setStatus(''); }
    finally { setBusy(false); }
  }
  async function restore(file) {
    if (!file) return;
    setError(''); setBusy(true); let restored = 0;
    try {
      if (file.size > 512 * 1024 * 1024) throw new Error('Backup exceeds 512 MB');
      setStatus('Unlocking and verifying the backup…');
      const files = await decryptDocuments(await file.text(), password);
      const latest = await request({ action: 'list' });
      const existing = new Set(latest.documents.filter(d => d.owner === latest.person).map(d => d.sha256));
      for (let i = 0; i < files.length; i++) {
        const f = files[i]; if (existing.has(f.sha256)) continue;
        setStatus(`Restoring document ${i + 1} of ${files.length}…`);
        await request({ action: 'import', name: f.name, base64: f.base64 });
        existing.add(f.sha256); restored++;
      }
      setPassword(''); setRepeat(''); setStatus(`Restored ${restored} private documents. Existing originals were skipped. Sharing and external access stay off for restored copies.`);
    } catch (e) { setError(`${e.message}. ${restored} documents restored; retry safely to continue.`); setStatus(''); }
    finally { setBusy(false); try { await onRestored(); } catch (e) { setError(e.message); } }
  }
  return <details><summary>Back up or restore my documents</summary>
    <p>This password-encrypted backup contains documents you own. It excludes other people’s files, conversations, settings, sharing permissions, and external access grants. Restored copies are private and kept until you delete them.</p>
    {error && <p role="alert">{error}</p>}{status && <p role="status">{status}</p>}
    <label>Backup password<input type="password" autoComplete="off" value={password} onChange={e => setPassword(e.target.value)} minLength={12} maxLength={1024} disabled={busy} /></label>
    <label>Repeat password to create a backup<input type="password" autoComplete="off" value={repeat} onChange={e => setRepeat(e.target.value)} disabled={busy} /></label>
    <button type="button" disabled={busy || password.length < 12 || !owned.length} onClick={save}>Download encrypted document backup</button>
    <label>Restore a document backup<input type="file" accept=".aspendocs" disabled={busy || password.length < 12} onChange={e => { restore(e.target.files[0]); e.target.value = ''; }} /></label>
  </details>;
}
