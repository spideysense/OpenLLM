(() => {
  const form = document.getElementById('waitlist-form');
  if (!form) return;
  const status = document.getElementById('waitlist-status');
  const success = document.getElementById('waitlist-success');
  const undo = document.getElementById('waitlist-undo');
  const submit = form.querySelector('button[type="submit"]');
  let signup = null;
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
    submit.disabled = true; submit.textContent = 'Saving your place…'; form.setAttribute('aria-busy', 'true'); message('');
    const email = form.elements.email.value.trim();
    try {
      const data = await request('POST', { email, consent: form.elements.consent.checked, website: form.elements.website.value, source: new URLSearchParams(location.search).get('utm_source') || 'direct' });
      signup = { email, receipt: data.receipt };
      form.hidden = true; success.hidden = false; undo.hidden = false;
      const title = success.querySelector('h2'); title.setAttribute('tabindex', '-1'); title.focus({ preventScroll: true });
      message('Your signup has been saved.');
    } catch (error) { message(error.name === 'TimeoutError' ? 'This is taking longer than expected. Please try again; we won’t add you twice.' : error.message, true); }
    finally { submit.disabled = false; submit.textContent = 'Join the waitlist ↗'; form.removeAttribute('aria-busy'); }
  });
  undo.addEventListener('click', async () => {
    if (!signup || undo.disabled) return;
    undo.disabled = true; message('Removing your signup…');
    try {
      const data = await request('DELETE', signup);
      if (!data.removed) throw new Error('This address may already have been on the list. Email hello@runonaspen.com to leave it.');
      signup = null; success.hidden = true; form.hidden = false; form.reset(); form.elements.email.focus({ preventScroll: true });
      message('Your signup has been removed.');
    } catch (error) { message(error.message, true); }
    finally { undo.disabled = false; }
  });
  document.querySelectorAll('a[href="#waitlist"]').forEach(link => link.addEventListener('click', () => {
    if (!form.hidden) form.elements.email.focus({ preventScroll: true });
  }));
})();
