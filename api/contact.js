/**
 * /api/contact — sends contact form submissions via Resend.
 * Env: RESEND_API_KEY
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { email, message, name } = req.body || {};
  if (!email || !message) return res.status(400).json({ error: 'Email and message required' });

  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) return res.status(503).json({ error: 'Contact form not configured' });

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        from: 'Aspen Contact <hello@runonaspen.com>',
        to: 'mayank.mehta@gmail.com',
        reply_to: email,
        subject: `[Aspen] Message from ${name || email}`,
        html: `
          <h3>New contact from runonaspen.com</h3>
          <p><strong>From:</strong> ${name || 'Not provided'} &lt;${email}&gt;</p>
          <hr>
          <p>${message.replace(/\n/g, '<br>')}</p>
          <hr>
          <p style="color:#999;font-size:12px">Sent from the Aspen website contact form</p>
        `,
      }),
    });

    if (!r.ok) {
      const err = await r.text();
      console.error('Resend error:', err);
      return res.status(500).json({ error: 'Failed to send' });
    }

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('Contact error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
}
