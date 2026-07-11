/**
 * Feedback API — two modes:
 *   1) Legacy one-shot:      { feedback, email }
 *   2) AI conversation:      { sessionId, transcript:[{role,content}], status:'partial'|'complete', surface, turn }
 *
 * The conversational mode is progressive: the client POSTs at every checkpoint
 * (after each answer, and on close/idle/unload), so an abandoned conversation
 * still delivers whatever was captured. Emails are threaded per sessionId, so
 * Gmail groups a session's updates and the last one holds the full transcript.
 *
 * Vercel env: RESEND_API_KEY
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://runonaspen.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) return res.status(500).json({ error: 'Email not configured' });

  const body = req.body || {};

  // ── Mode 2: AI conversation (progressive) ──────────────────────────────────
  if (Array.isArray(body.transcript)) {
    const { sessionId, transcript, status = 'partial', surface = 'web', turn = 0 } = body;
    if (!sessionId || !transcript.length) return res.status(400).json({ error: 'sessionId + transcript required' });

    const rows = transcript
      .filter((m) => m && m.content && String(m.content).trim())
      .map((m) => {
        const who = m.role === 'user' ? 'User' : 'Aspen';
        const color = m.role === 'user' ? '#1D1D1F' : '#B8860B';
        const bg = m.role === 'user' ? '#FFFFFF' : '#FAFAF7';
        return `<div style="margin:0 0 10px;padding:12px 14px;background:${bg};border:1px solid #E5E5EA;border-radius:10px">
          <div style="font-size:11px;font-weight:600;color:${color};margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em">${who}</div>
          <div style="font-size:14px;line-height:1.6;color:#1D1D1F;white-space:pre-wrap">${escHtml(m.content)}</div>
        </div>`;
      })
      .join('');

    const badge = status === 'complete'
      ? '<span style="background:#DCFCE7;color:#166534;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600">COMPLETED</span>'
      : '<span style="background:#FEF9C3;color:#854D0E;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600">IN PROGRESS</span>';

    const mid = `<fb-${String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '')}@runonaspen.com>`;
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Aspen Feedback <feedback@runonaspen.com>',
          to: 'mayank.mehta@gmail.com',
          subject: `🌿 Aspen feedback · ${String(sessionId).slice(-6)}`,
          headers: { 'References': mid, 'In-Reply-To': mid },
          html: `
            <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:600px;margin:0 auto;padding:28px 20px;color:#1D1D1F">
              <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px">
                <h2 style="font-size:17px;font-weight:600;margin:0;color:#B8860B">🌿 Aspen feedback conversation</h2>${badge}
              </div>
              ${rows}
              <p style="margin-top:16px;font-size:12px;color:#AEAEB2">Session ${escHtml(String(sessionId))} · ${escHtml(surface)} · turn ${escHtml(String(turn))} · ${new Date().toUTCString()}</p>
            </div>`,
        }),
      });
      if (!r.ok) { console.error('Resend error:', await r.text()); return res.status(500).json({ error: 'Failed to send' }); }
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('Feedback (convo) error:', err);
      return res.status(500).json({ error: 'Failed to send feedback' });
    }
  }

  // ── Mode 1: legacy one-shot ─────────────────────────────────────────────────
  const { feedback, email } = body;
  if (!feedback?.trim()) return res.status(400).json({ error: 'Feedback required' });
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Aspen Feedback <feedback@runonaspen.com>',
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
