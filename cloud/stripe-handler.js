const Stripe = require('stripe');
const db = require('./db');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_xxx');

const LANDING_URL = process.env.LANDING_URL || 'https://open-llm-ten.vercel.app';

// Stripe Price IDs — create these in your Stripe dashboard
const PRICE_IDS = {
  cloud:   process.env.STRIPE_PRICE_CLOUD   || 'price_cloud_placeholder',
  grizzly: process.env.STRIPE_PRICE_GRIZZLY || 'price_grizzly_placeholder',
};

/**
 * POST /checkout — create a Stripe Checkout session
 * Body: { plan: 'cloud' | 'grizzly', email?: string }
 */
async function createCheckout(req, res) {
  const { plan, email } = req.body;

  if (!PRICE_IDS[plan]) {
    return res.status(400).json({ error: 'Invalid plan. Use "cloud" or "grizzly".' });
  }

  const sessionConfig = {
    mode: 'subscription',
    line_items: [{ price: PRICE_IDS[plan], quantity: 1 }],
    success_url: `${LANDING_URL}/welcome?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${LANDING_URL}/#pricing`,
    metadata: { plan },
    allow_promotion_codes: true,
  };

  // Pre-fill email if provided
  if (email) sessionConfig.customer_email = email;

  try {
    const session = await stripe.checkout.sessions.create(sessionConfig);
    res.json({ url: session.url, session_id: session.id });
  } catch (err) {
    console.error('[Stripe] Checkout error:', err.message);
    res.status(500).json({ error: 'Failed to create checkout session.' });
  }
}

/**
 * POST /webhooks/stripe — handle Stripe webhook events
 * Must use raw body for signature verification
 */
async function handleWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

  let event;
  try {
    if (endpointSecret) {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } else {
      event = JSON.parse(req.body);
    }
  } catch (err) {
    console.error('[Stripe] Webhook signature failed:', err.message);
    return res.status(400).json({ error: 'Webhook signature verification failed.' });
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      await provisionUser(session);
      break;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object;
      await updateSubscription(sub);
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      await cancelSubscription(sub);
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      console.warn('[Stripe] Payment failed for customer:', invoice.customer);
      break;
    }

    default:
      // Ignore other events
      break;
  }

  res.json({ received: true });
}

/**
 * Provision a new user after successful checkout
 */
async function provisionUser(session) {
  const email = session.customer_details?.email || session.customer_email;
  const name = session.customer_details?.name || '';
  const plan = session.metadata?.plan || 'cloud';
  const stripeCustomerId = session.customer;
  const stripeSubscriptionId = session.subscription;

  if (!email) {
    console.error('[Stripe] No email in checkout session:', session.id);
    return;
  }

  // Check if user already exists
  let user = db.getUserByEmail(email);

  if (user) {
    // Upgrade existing user
    db.updateUserPlan(user.id, plan, stripeSubscriptionId);
    if (!user.stripe_customer_id) {
      db.updateStripeCustomer(user.id, stripeCustomerId);
    }
    user = db.getUserById(user.id);
  } else {
    // Create new user
    user = db.createUser({ email, name, plan, stripeCustomerId });
    db.updateUserPlan(user.id, plan, stripeSubscriptionId);
  }

  // Auto-generate first API key
  const existingKeys = db.listApiKeys(user.id);
  if (existingKeys.length === 0) {
    const key = db.createApiKey(user.id, 'Default (auto-created)');
    console.log(`[Stripe] Provisioned ${email} on ${plan}. API key: ${key.prefix}`);
  }

  return user;
}

/**
 * Handle subscription plan change
 */
async function updateSubscription(sub) {
  const user = db.getUserByStripeCustomer(sub.customer);
  if (!user) return;

  // Map Stripe price to our plan
  const priceId = sub.items?.data?.[0]?.price?.id;
  let plan = 'cloud';
  if (priceId === PRICE_IDS.grizzly) plan = 'grizzly';

  if (sub.status === 'active') {
    db.updateUserPlan(user.id, plan, sub.id);
    console.log(`[Stripe] Updated ${user.email} to ${plan}`);
  }
}

/**
 * Handle subscription cancellation — downgrade to free
 */
async function cancelSubscription(sub) {
  const user = db.getUserByStripeCustomer(sub.customer);
  if (!user) return;

  db.updateUserPlan(user.id, 'free', null);
  console.log(`[Stripe] Cancelled ${user.email}, downgraded to free`);
}

/**
 * GET /account — get account info + API keys (for welcome page)
 * Query: ?session_id=cs_xxx
 */
async function getAccount(req, res) {
  const { session_id } = req.query;

  if (!session_id) {
    return res.status(400).json({ error: 'Missing session_id' });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    const email = session.customer_details?.email || session.customer_email;

    if (!email) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const user = db.getUserByEmail(email);
    if (!user) {
      return res.status(404).json({ error: 'User not yet provisioned. Webhook may still be processing.' });
    }

    const keys = db.listApiKeys(user.id);
    const plan = db.getPlan(user.plan);

    res.json({
      email: user.email,
      plan: user.plan,
      plan_name: plan.name,
      limits: { rpm: plan.rpm, daily_tokens: plan.dailyTokens },
      api_keys: keys,
      api_base_url: process.env.API_BASE_URL || 'https://api.monet.com/v1',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { createCheckout, handleWebhook, getAccount, PRICE_IDS };
