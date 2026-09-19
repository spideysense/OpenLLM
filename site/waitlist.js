(() => {
  const form = document.getElementById('waitlist-form');
  if (!form) return;
  const status = document.getElementById('waitlist-status');
  const success = document.getElementById('waitlist-success');
  const undo = document.getElementById('waitlist-undo');
  const submit = form.querySelector('button[type="submit"]');
  let signup = null;
  let privateReceipt = null;
  let stateEpoch = 0;
  const panel = document.getElementById('referral-panel');
  const storageKey = 'aspen.waitlist.receipt.v1';
  const referral = new URLSearchParams(location.search).get('ref') || '';
  const receiptPattern = /^[A-Za-z0-9_-]{43}$/;
  async function loadPosition(receipt, reveal = false) {
    const epoch = stateEpoch;
    const data = await request('PATCH', { receipt });
    if (epoch !== stateEpoch) return false;
    if (!data.waitlist) return false;
    privateReceipt = receipt;
    try { localStorage.setItem(storageKey, receipt); } catch {}
    if (reveal) { form.hidden = true; success.hidden = false; undo.hidden = !signup; }
    panel.hidden = false;
    document.getElementById('copy-referral').disabled = false;
    document.getElementById('waitlist-position').textContent = '#' + data.waitlist.position.toLocaleString();
    document.getElementById('waitlist-referrals').textContent = data.waitlist.referrals.toLocaleString();
    document.getElementById('referral-link').value = 'https://www.runonaspen.com/?ref=' + encodeURIComponent(data.waitlist.code) + '#waitlist';
    return true;
  }
  async function copy(text, confirmation) {
    try { await navigator.clipboard.writeText(text); message(confirmation); }
    catch { message('Copy is unavailable in this browser. Select and copy the link below.'); const field = document.getElementById('referral-link'); if (field.value === text) { field.focus(); field.select(); } else { const link = document.createElement('input'); link.readOnly = true; link.value = text; link.setAttribute('aria-label', 'Private status link'); panel.append(link); link.focus(); link.select(); } }
  }
  document.getElementById('copy-referral').addEventListener('click', () => copy(document.getElementById('referral-link').value, 'Invite link copied. Share it with someone who would love Aspen.'));
  document.getElementById('copy-status').addEventListener('click', () => { if (privateReceipt) copy('https://www.runonaspen.com/#waitlist/' + privateReceipt, 'Private status link copied. Keep this one to yourself.'); });
  document.getElementById('refresh-position').addEventListener('click', async event => {
    const button = event.currentTarget; button.disabled = true;
    try { if (!await loadPosition(privateReceipt)) throw new Error('This signup is no longer active.'); message('Your position is up to date.'); }
    catch (error) { message(error.message, true); }
    finally { button.disabled = false; }
  });
  let savedReceipt = location.hash.startsWith('#waitlist/') ? location.hash.slice(10) : null;
  if (savedReceipt && receiptPattern.test(savedReceipt)) history.replaceState(null, '', location.pathname + location.search + '#waitlist');
  if (!savedReceipt) { try { savedReceipt = localStorage.getItem(storageKey); } catch {} }
  if (savedReceipt && receiptPattern.test(savedReceipt)) {
    loadPosition(savedReceipt, true).then(found => { if (!found) { try { if (localStorage.getItem(storageKey) === savedReceipt) localStorage.removeItem(storageKey); } catch {} } }).catch(error => message(error.message, true));
  }
  async function request(method, body) {
    const response = await fetch('/api/waitlist', {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    let data;
    try { data = await response.json(); } catch {}
    if (!response.ok || !data?.ok) throw new Error(data?.error || 'We couldn’t save that just now. Please try again.');
    return data;
  }
  function message(text, error = false) { status.textContent = text; status.classList.toggle('is-error', error); }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submit.disabled || !form.reportValidity()) return;
    stateEpoch++;
    submit.disabled = true; submit.textContent = 'Saving your place…'; form.setAttribute('aria-busy', 'true'); message('');
    const email = form.elements.email.value.trim();
    try {
      const data = await request('POST', { email, consent: form.elements.consent.checked, website: form.elements.website.value, source: new URLSearchParams(location.search).get('utm_source') || 'direct', ref: referral });
      signup = { email, receipt: data.receipt };
      form.hidden = true; success.hidden = false; undo.hidden = false;
      const title = success.querySelector('h2'); title.setAttribute('tabindex', '-1'); title.focus({ preventScroll: true });
      message('Your signup has been saved.');
      try {
        const found = await loadPosition(data.receipt);
        if (!found) message('Your signup request is complete. If you joined earlier, use your saved private status link to see your position.');
      } catch { message('Your signup is saved. Your position is temporarily unavailable. Try refreshing below.', true); privateReceipt = data.receipt; try { localStorage.setItem(storageKey, data.receipt); } catch {} document.getElementById('refresh-position').hidden = false; panel.hidden = false; document.getElementById('copy-referral').disabled = true; }

    } catch (error) { message(error.name === 'TimeoutError' ? 'This is taking longer than expected. Please try again; we won’t add you twice.' : error.message, true); }
    finally { submit.disabled = false; submit.textContent = 'Join the waitlist ↗'; form.removeAttribute('aria-busy'); }
  });
  undo.addEventListener('click', async () => {
    if (!signup || undo.disabled) return;
    undo.disabled = true; message('Removing your signup…');
    try {
      const data = await request('DELETE', signup);
      if (!data.removed) throw new Error('This address may already have been on the list. Email hello@runonaspen.com to leave it.');
      stateEpoch++; signup = null; privateReceipt = null; panel.hidden = true; try { localStorage.removeItem(storageKey); } catch {} success.hidden = true; form.hidden = false; form.reset(); form.elements.email.focus({ preventScroll: true });
      message('Your signup has been removed.');
    } catch (error) { message(error.message, true); }
    finally { undo.disabled = false; }
  });
  document.querySelectorAll('a[href="#waitlist"]').forEach(link => link.addEventListener('click', () => {
    if (!form.hidden) form.elements.email.focus({ preventScroll: true });
  }));
})();
