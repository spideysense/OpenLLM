/**
 * Preorder Checkout — creates a Stripe Checkout Session for $1 deposit
 *
 * Vercel env vars needed:
 *   STRIPE_SECRET_KEY — from Stripe dashboard (sk_live_... or sk_test_...)
 *
 * Flow:
 *   1. User fills in name + email in the modal
 *   2. POST /api/preorder-checkout → returns { url } (Stripe Checkout page)
 *   3. Browser redirects to Stripe
 *   4. On payment success, Stripe redirects to /preorder-success?name=...&email=...
 *   5. /api/preorder-success sends confirmation emails via Resend
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://runonaspen.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { name, email } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'Name and email required' });

  const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_KEY) return res.status(500).json({ error: 'Stripe not configured' });

  const baseUrl = 'https://runonaspen.com';
  const encodedName = encodeURIComponent(name);
  const encodedEmail = encodeURIComponent(email);

  try {
    const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${STRIPE_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        mode: 'payment',
        'payment_method_types[]': 'card',
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][unit_amount]': '100', // $1.00
        'line_items[0][price_data][product_data][name]': 'Aspen Device — Pre-order Deposit',
        'line_items[0][price_data][product_data][description]': 'Reserve your Aspen device. $1 deposit, applied toward the full $10,000 price.',
        'line_items[0][quantity]': '1',
        'customer_email': email,
        'success_url': `${baseUrl}/api/preorder-success?name=${encodedName}&email=${encodedEmail}&session_id={CHECKOUT_SESSION_ID}`,
        'cancel_url': `${baseUrl}/?preorder=cancelled`,
        'metadata[name]': name,
        'metadata[email]': email,
      }).toString(),
    });

    if (!resp.ok) {
      const err = await resp.json();
      console.error('Stripe error:', err);
      return res.status(502).json({ error: 'Stripe error', detail: err.error?.message });
    }

    const session = await resp.json();
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Checkout session error:', err);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
}
