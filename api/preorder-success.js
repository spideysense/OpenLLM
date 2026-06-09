/**
 * Preorder Success — called after Stripe payment succeeds
 * Sends confirmation + notification emails via Resend
 *
 * Vercel env vars needed:
 *   RESEND_API_KEY
 *   STRIPE_SECRET_KEY (to verify payment isn't fake)
 */

export default async function handler(req, res) {
  const { name, email, session_id } = req.query;

  if (!name || !email || !session_id) {
    return res.redirect(302, '/?preorder=error');
  }

  const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
  const RESEND_KEY = process.env.RESEND_API_KEY;

  // Verify payment actually succeeded with Stripe
  if (STRIPE_KEY) {
    try {
      const verifyResp = await fetch(`https://api.stripe.com/v1/checkout/sessions/${session_id}`, {
        headers: { Authorization: `Bearer ${STRIPE_KEY}` },
      });
      const session = await verifyResp.json();
      if (session.payment_status !== 'paid') {
        console.warn('Preorder success called but not paid:', session_id);
        return res.redirect(302, '/?preorder=unpaid');
      }
    } catch (err) {
      console.error('Stripe verify error:', err);
      // Don't block — still send email if Stripe check fails
    }
  }

  // Send emails
  if (RESEND_KEY) {
    try {
      await sendEmail(RESEND_KEY, {
        from: 'Aspen <mayank@trybutler.xyz>',
        to: decodeURIComponent(email),
        subject: 'Your Aspen pre-order is confirmed ✓',
        html: `
          <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:520px;margin:0 auto;padding:40px 20px;color:#1D1D1F">
            <h1 style="font-size:24px;font-weight:600;margin-bottom:16px">You're on the list, ${escHtml(decodeURIComponent(name))}.</h1>
            <p style="font-size:16px;line-height:1.7;color:#6E6E73">Your $1 deposit confirms your Aspen device pre-order. It'll be applied toward the full price when we're ready to ship. You're one of the first.</p>
            <p style="font-size:16px;line-height:1.7;color:#6E6E73;margin-top:16px">In the meantime, <a href="https://runonaspen.com" style="color:#B8860B;text-decoration:none;font-weight:500">download the free Aspen software</a> and start running private AI on your current machine today.</p>
            <hr style="border:none;border-top:1px solid #E5E5E5;margin:32px 0">
            <p style="font-size:13px;color:#AEAEB2">Aspen &middot; Own your intelligence &middot; <a href="https://runonaspen.com" style="color:#B8860B;text-decoration:none">runonaspen.com</a></p>
          </div>`,
      });

      await sendEmail(RESEND_KEY, {
        from: 'Aspen Pre-orders <mayank@trybutler.xyz>',
        to: 'mayank.mehta@gmail.com',
        subject: `💰 New paid pre-order: ${decodeURIComponent(name)}`,
        html: `
          <div style="font-family:-apple-system,sans-serif;padding:20px;color:#1D1D1F">
            <h2 style="font-size:18px;margin-bottom:12px">New $1 pre-order deposit</h2>
            <p><strong>Name:</strong> ${escHtml(decodeURIComponent(name))}</p>
            <p><strong>Email:</strong> ${escHtml(decodeURIComponent(email))}</p>
            <p><strong>Stripe session:</strong> ${escHtml(session_id)}</p>
            <p><strong>Time:</strong> ${new Date().toISOString()}</p>
            <p style="margin-top:16px"><a href="mailto:${escHtml(decodeURIComponent(email))}" style="color:#B8860B">Reply to ${escHtml(decodeURIComponent(name))}</a></p>
          </div>`,
      });
    } catch (err) {
      console.error('Email error:', err.message);
    }
  }

  // Redirect to success page
  return res.redirect(302, `/?preorder=success&name=${encodeURIComponent(decodeURIComponent(name))}`);
}

async function sendEmail(apiKey, payload) {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(`Resend ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
