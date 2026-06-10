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

  const { name, email, plan = 'full' } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'Name and email required' });

  const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_KEY) return res.status(500).json({ error: 'Stripe not configured' });

  const baseUrl = 'https://runonaspen.com';
  const encodedName = encodeURIComponent(name);
  const encodedEmail = encodeURIComponent(email);
  const successUrl = `${baseUrl}/api/preorder-success?name=${encodedName}&email=${encodedEmail}&plan=${plan}&session_id={CHECKOUT_SESSION_ID}`;

  try {
    let body;

    if (plan === 'installments') {
      // $299/month subscription for 36 months
      body = new URLSearchParams({
        mode: 'subscription',
        'payment_method_types[]': 'card',
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][unit_amount]': '29900', // $299.00
        'line_items[0][price_data][recurring][interval]': 'month',
        'line_items[0][price_data][product_data][name]': 'Aspen Device — Monthly Installment',
        'line_items[0][price_data][product_data][description]': '$299/month for 36 months. Aspen device ships when ready.',
        'line_items[0][quantity]': '1',
        'subscription_data[metadata][plan]': 'installments',
        'subscription_data[metadata][name]': name,
        'customer_email': email,
        'success_url': successUrl,
        'cancel_url': `${baseUrl}/?preorder=cancelled`,
        'metadata[name]': name,
        'metadata[email]': email,
        'metadata[plan]': 'installments',
      }).toString();
    } else {
      // $10,000 one-time payment
      body = new URLSearchParams({
        mode: 'payment',
        'payment_method_types[]': 'card',
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][unit_amount]': '1000000', // $10,000.00
        'line_items[0][price_data][product_data][name]': 'Aspen Device',
        'line_items[0][price_data][product_data][description]': 'Private AI device. Ships when ready.',
        'line_items[0][quantity]': '1',
        'customer_email': email,
        'success_url': successUrl,
        'cancel_url': `${baseUrl}/?preorder=cancelled`,
        'metadata[name]': name,
        'metadata[email]': email,
        'metadata[plan]': 'full',
      }).toString();
    }

    const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${STRIPE_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    if (!resp.ok) {
      const err = await resp.json();
      return res.status(502).json({ error: 'Stripe error', detail: err.error?.message });
    }

    const session = await resp.json();
    return res.status(200).json({ url: session.url });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
}
