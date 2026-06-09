/**
 * Feedback API — receives open-text feedback from the beta banner modal
 * Sends to mayank.mehta@gmail.com via Resend
 *
 * Vercel env vars needed:
 *   RESEND_API_KEY
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://runonaspen.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { feedback, email } = req.body || {};
  if (!feedback?.trim()) return res.status(400).json({ error: 'Feedback required' });

  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) return res.status(500).json({ error: 'Email not configured' });

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Aspen Feedback <mayank@trybutler.xyz>',
        to: 'mayank.mehta@gmail.com',
        reply_to: email?.trim() || undefined,
        subject: email?.trim() ? `Aspen feedback from ${email.trim()}` : 'Aspen feedback (anonymous)',
        html: `
          <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:560px;margin:0 auto;padding:32px 20px;color:#1D1D1F">
            <h2 style="font-size:18px;font-weight:600;margin-bottom:16px;color:#B8860B">🌿 New Aspen Feedback</h2>
            <div style="background:#FAFAF7;border:1px solid #E5E5EA;border-radius:12px;padding:20px;font-size:15px;line-height:1.7;white-space:pre-wrap">${escHtml(feedback.trim())}</div>
            ${email?.trim() ? `<p style="margin-top:16px;font-size:13px;color:#6E6E73">From: <a href="mailto:${escHtml(email.trim())}" style="color:#B8860B">${escHtml(email.trim())}</a></p>` : '<p style="margin-top:16px;font-size:13px;color:#AEAEB2">No email provided (anonymous)</p>'}
            <p style="margin-top:8px;font-size:12px;color:#AEAEB2">Sent ${new Date().toUTCString()}</p>
          </div>`,
      }),
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Feedback email error:', err);
    return res.status(500).json({ error: 'Failed to send feedback' });
  }
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
