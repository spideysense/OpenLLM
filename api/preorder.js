/**
 * Pre-order API — sends confirmation + notification emails via Resend
 *
 * Vercel env vars needed:
 *   RESEND_API_KEY  — from resend.com dashboard
 *   PREORDER_NOTIFY — email to notify (e.g. mayank@trybutler.xyz)
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { name, email } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'Name and email required' });

  const RESEND_KEY = process.env.RESEND_API_KEY;
  const NOTIFY = process.env.PREORDER_NOTIFY || 'mayank@trybutler.xyz';

  if (!RESEND_KEY) return res.status(500).json({ error: 'Email not configured' });

  try {
    // 1. Confirmation to the customer
    await sendEmail(RESEND_KEY, {
      from: 'Aspen <hello@runonaspen.com>',
      to: email,
      subject: 'Your Aspen pre-order is confirmed',
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:520px;margin:0 auto;padding:40px 20px;color:#1D1D1F;">
          <h1 style="font-size:24px;font-weight:600;margin-bottom:16px;">Thank you, ${escHtml(name)}.</h1>
          <p style="font-size:16px;line-height:1.7;color:#6E6E73;">
            Your Aspen pre-order has been received. We'll reach out when your device is ready to ship.
          </p>
          <p style="font-size:16px;line-height:1.7;color:#6E6E73;margin-top:16px;">
            In the meantime, you can <a href="https://github.com/spideysense/OpenLLM/releases/latest" style="color:#B8860B;text-decoration:none;font-weight:500;">download the free Aspen software</a> and start running private AI on your current computer.
          </p>
          <hr style="border:none;border-top:1px solid #E5E5E5;margin:32px 0;" />
          <p style="font-size:13px;color:#AEAEB2;">Aspen &middot; Own your intelligence &middot; <a href="https://runonaspen.com" style="color:#B8860B;text-decoration:none;">runonaspen.com</a></p>
        </div>
      `,
    });

    // 2. Notification to Mayank (separate email)
    await sendEmail(RESEND_KEY, {
      from: 'Aspen Pre-orders <hello@runonaspen.com>',
      to: NOTIFY,
      subject: `New Aspen pre-order: ${name}`,
      html: `
        <div style="font-family:-apple-system,sans-serif;padding:20px;color:#1D1D1F;">
          <h2 style="font-size:18px;margin-bottom:12px;">New pre-order</h2>
          <p><strong>Name:</strong> ${escHtml(name)}</p>
          <p><strong>Email:</strong> ${escHtml(email)}</p>
          <p><strong>Time:</strong> ${new Date().toISOString()}</p>
          <p style="margin-top:16px;"><a href="mailto:${escHtml(email)}" style="color:#B8860B;">Reply to ${escHtml(name)}</a></p>
        </div>
      `,
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Preorder email error:', err);
    return res.status(500).json({ error: 'Failed to send email', detail: err.message });
  }
}

async function sendEmail(apiKey, payload) {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Resend ${resp.status}: ${text}`);
  }
  return resp.json();
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
