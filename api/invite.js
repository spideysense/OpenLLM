export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { inviteeName, inviteeEmail, tunnelUrl, apiKey, inviterName } = req.body || {};
  if (!inviteeEmail || !tunnelUrl || !apiKey) return res.status(400).json({ error: 'inviteeEmail, tunnelUrl, apiKey required' });

  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) return res.status(500).json({ error: 'Email not configured' });

  const base = tunnelUrl.replace(/\/v1\/?$/, '').replace(/\/+$/, '');
  const params = new URLSearchParams({ tunnel: base, key: apiKey });
  const magicLink = `https://runonaspen.com/app#${params.toString()}`;
  const name = inviteeName || inviteeEmail.split('@')[0];
  const from = inviterName || 'Someone';

  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Aspen <mayank@trybutler.xyz>',
        to: inviteeEmail,
        subject: `${from} invited you to use their private AI`,
        html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#FAFAF7;font-family:-apple-system,sans-serif;"><div style="max-width:520px;margin:40px auto;padding:0 20px;"><div style="background:#fff;border-radius:16px;padding:40px;border:1px solid rgba(0,0,0,0.07);"><div style="font-size:13px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#B8860B;margin-bottom:28px;">ASPEN</div><h1 style="font-size:26px;font-weight:400;color:#1D1D1F;margin:0 0 12px;">${esc(from)} invited you to their <em style="color:#B8860B;">private AI</em></h1><p style="font-size:15px;color:#6E6E73;line-height:1.7;margin:0 0 28px;">Hey ${esc(name)} — ${esc(from)} is sharing access to their local Aspen AI. No subscriptions, no cloud, no data sharing.</p><a href="${esc(magicLink)}" style="display:inline-block;background:#1D1D1F;color:#FAFAF7;text-decoration:none;padding:14px 28px;border-radius:10px;font-size:15px;font-weight:500;margin-bottom:28px;">Open your private AI →</a><div style="background:rgba(184,134,11,0.06);border-radius:10px;padding:16px;margin-bottom:28px;font-size:13px;color:#B8860B;"><strong>Your key is already embedded in that link.</strong> Click once and you're connected.</div><p style="font-size:13px;color:#AEAEB2;">Powered by <a href="https://runonaspen.com" style="color:#B8860B;text-decoration:none;">Aspen</a>. If you didn't expect this, ignore this email.</p></div></div></body></html>`,
      }),
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to send', detail: err.message });
  }
}
