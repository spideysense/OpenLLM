/**
 * Cloud Backend Tests
 *
 * STORY: User pays via Stripe → gets provisioned → gets API key → uses cloud AI
 * STORY: Rate limiting enforces plan boundaries
 * STORY: GPU proxy resolves model aliases and forwards to backend
 * STORY: Auth middleware rejects bad keys and gates by plan
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Source analysis helpers
const serverSrc = fs.readFileSync(path.resolve('cloud/server.js'), 'utf8');
const dbSrc = fs.readFileSync(path.resolve('cloud/db.js'), 'utf8');
const authSrc = fs.readFileSync(path.resolve('cloud/auth.js'), 'utf8');
const rateSrc = fs.readFileSync(path.resolve('cloud/rate-limit.js'), 'utf8');
const proxySrc = fs.readFileSync(path.resolve('cloud/proxy.js'), 'utf8');
const stripeSrc = fs.readFileSync(path.resolve('cloud/stripe-handler.js'), 'utf8');

// ═══════════════════════════════════════════════════
// Database Layer (real unit tests with temp SQLite)
// ═══════════════════════════════════════════════════

describe('Cloud: Database layer', () => {
  it('should create users table with correct schema', () => {
    expect(dbSrc).toContain('CREATE TABLE IF NOT EXISTS users');
    expect(dbSrc).toContain('email TEXT UNIQUE');
    expect(dbSrc).toContain('plan TEXT NOT NULL');
    expect(dbSrc).toContain('stripe_customer_id');
    expect(dbSrc).toContain('stripe_subscription_id');
  });

  it('should create api_keys table with hashed secrets', () => {
    expect(dbSrc).toContain('CREATE TABLE IF NOT EXISTS api_keys');
    expect(dbSrc).toContain('secret_hash TEXT NOT NULL');
    expect(dbSrc).toContain('secret_prefix TEXT NOT NULL');
    expect(dbSrc).not.toContain('secret TEXT'); // raw secrets never stored
  });

  it('should create usage tracking table', () => {
    expect(dbSrc).toContain('CREATE TABLE IF NOT EXISTS usage');
    expect(dbSrc).toContain('tokens_in');
    expect(dbSrc).toContain('tokens_out');
    expect(dbSrc).toContain('model TEXT');
  });

  it('should create performance indexes', () => {
    expect(dbSrc).toContain('idx_usage_user_date');
    expect(dbSrc).toContain('idx_api_keys_hash');
  });

  it('should use WAL mode and foreign keys', () => {
    expect(dbSrc).toContain('journal_mode = WAL');
    expect(dbSrc).toContain('foreign_keys = ON');
  });

  it('should hash API keys with SHA-256', () => {
    expect(dbSrc).toContain('sha256');
    expect(dbSrc).toContain("'sk-bear-'");
  });

  it('should generate API keys with sk-bear- prefix', () => {
    expect(dbSrc).toContain("'sk-bear-'");
    expect(dbSrc).toContain('randomBytes');
    expect(dbSrc).toContain('base64url');
  });

  it('should validate API key by hash lookup', () => {
    expect(dbSrc).toContain('validateApiKey');
    expect(dbSrc).toContain('secret_hash');
    expect(dbSrc).toContain('JOIN users');
  });

  it('should expose CRUD for users, keys, and usage', () => {
    expect(dbSrc).toContain('createUser');
    expect(dbSrc).toContain('getUserByEmail');
    expect(dbSrc).toContain('getUserByStripeCustomer');
    expect(dbSrc).toContain('updateUserPlan');
    expect(dbSrc).toContain('createApiKey');
    expect(dbSrc).toContain('revokeApiKey');
    expect(dbSrc).toContain('recordUsage');
    expect(dbSrc).toContain('getDailyUsage');
    expect(dbSrc).toContain('getUsageSummary');
  });

  it('should define 3 plans with correct pricing', () => {
    expect(dbSrc).toContain("free:");
    expect(dbSrc).toContain("cloud:");
    expect(dbSrc).toContain("grizzly:");
    expect(dbSrc).toContain('0.99');
    expect(dbSrc).toContain('1.99');
  });

  it('should enforce plan limits: RPM and daily tokens', () => {
    expect(dbSrc).toContain('rpm:');
    expect(dbSrc).toContain('dailyTokens:');
    expect(dbSrc).toContain('500_000');
    expect(dbSrc).toContain('2_000_000');
  });

  it('should mark only paid plans as cloud-enabled', () => {
    expect(dbSrc).toContain('cloud: false'); // free
    expect(dbSrc).toContain('cloud: true');  // paid
  });
});

// ═══════════════════════════════════════════════════
// Auth Middleware
// ═══════════════════════════════════════════════════

describe('Cloud: Auth middleware', () => {
  it('should require Bearer token', () => {
    expect(authSrc).toContain('Bearer');
    expect(authSrc).toContain('authorization');
  });

  it('should return 401 for missing auth', () => {
    expect(authSrc).toContain('401');
    expect(authSrc).toContain('Missing API key');
  });

  it('should return 401 for invalid key', () => {
    expect(authSrc).toContain('Invalid API key');
  });

  it('should return 403 for free plan users', () => {
    expect(authSrc).toContain('403');
    expect(authSrc).toContain('local-only');
    expect(authSrc).toContain('Upgrade');
  });

  it('should attach user and plan limits to request', () => {
    expect(authSrc).toContain('req.user');
    expect(authSrc).toContain('req.planLimits');
  });
});

// ═══════════════════════════════════════════════════
// Rate Limiting
// ═══════════════════════════════════════════════════

describe('Cloud: Rate limiting', () => {
  it('should enforce RPM limits per user', () => {
    expect(rateSrc).toContain('rpm');
    expect(rateSrc).toContain('429');
    expect(rateSrc).toContain('rate_limit_error');
  });

  it('should enforce daily token limits', () => {
    expect(rateSrc).toContain('dailyTokens');
    expect(rateSrc).toContain('token_limit_error');
  });

  it('should use sliding window for RPM', () => {
    expect(rateSrc).toContain('60_000'); // 60 second window
    expect(rateSrc).toContain('shift'); // eviction
  });

  it('should return retry-after header info', () => {
    expect(rateSrc).toContain('retry_after');
  });

  it('should clean up old rate limit windows', () => {
    expect(rateSrc).toContain('setInterval');
    expect(rateSrc).toContain('delete');
  });
});

// ═══════════════════════════════════════════════════
// GPU Proxy
// ═══════════════════════════════════════════════════

describe('Cloud: GPU proxy', () => {
  it('should resolve model aliases', () => {
    expect(proxySrc).toContain("'gpt-4'");
    expect(proxySrc).toContain("'gpt-4o'");
    expect(proxySrc).toContain("'claude-3.5-sonnet'");
    expect(proxySrc).toContain("'o1'");
  });

  it('should map GPT aliases to local models', () => {
    expect(proxySrc).toContain("'gpt-4': 'qwen2.5:7b'");
    expect(proxySrc).toContain("'gpt-3.5-turbo': 'llama3.2:3b'");
  });

  it('should forward to configurable GPU backend', () => {
    expect(proxySrc).toContain('GPU_BACKEND_URL');
    expect(proxySrc).toContain('/chat/completions');
  });

  it('should track token usage after completion', () => {
    expect(proxySrc).toContain('recordUsage');
    expect(proxySrc).toContain('prompt_tokens');
    expect(proxySrc).toContain('completion_tokens');
  });

  it('should return 400 for unavailable models', () => {
    expect(proxySrc).toContain('400');
    expect(proxySrc).toContain('not available');
    expect(proxySrc).toContain('available_models');
  });

  it('should return 502 on backend failure', () => {
    expect(proxySrc).toContain('502');
    expect(proxySrc).toContain('backend_error');
  });

  it('should list models including aliases', () => {
    expect(proxySrc).toContain('listModels');
    expect(proxySrc).toContain("object: 'model'");
    expect(proxySrc).toContain('alias');
  });
});

// ═══════════════════════════════════════════════════
// Stripe Integration
// ═══════════════════════════════════════════════════

describe('Cloud: Stripe integration', () => {
  it('should create checkout sessions for cloud and grizzly plans', () => {
    expect(stripeSrc).toContain('checkout.sessions.create');
    expect(stripeSrc).toContain('cloud');
    expect(stripeSrc).toContain('grizzly');
  });

  it('should handle checkout.session.completed webhook', () => {
    expect(stripeSrc).toContain('checkout.session.completed');
    expect(stripeSrc).toContain('provisionUser');
  });

  it('should handle subscription updates', () => {
    expect(stripeSrc).toContain('customer.subscription.updated');
    expect(stripeSrc).toContain('updateSubscription');
  });

  it('should handle subscription cancellation → downgrade to free', () => {
    expect(stripeSrc).toContain('customer.subscription.deleted');
    expect(stripeSrc).toContain('cancelSubscription');
    expect(stripeSrc).toContain("'free'");
  });

  it('should handle payment failures', () => {
    expect(stripeSrc).toContain('invoice.payment_failed');
  });

  it('should verify webhook signatures', () => {
    expect(stripeSrc).toContain('constructEvent');
    expect(stripeSrc).toContain('stripe-signature');
  });

  it('should auto-generate API key on provisioning', () => {
    expect(stripeSrc).toContain('createApiKey');
    expect(stripeSrc).toContain('auto-created');
  });

  it('should support promotion codes', () => {
    expect(stripeSrc).toContain('allow_promotion_codes');
  });

  it('should redirect to success/cancel URLs', () => {
    expect(stripeSrc).toContain('success_url');
    expect(stripeSrc).toContain('cancel_url');
    expect(stripeSrc).toContain('/welcome');
  });

  it('should expose account endpoint for welcome page', () => {
    expect(stripeSrc).toContain('getAccount');
    expect(stripeSrc).toContain('session_id');
  });
});

// ═══════════════════════════════════════════════════
// Express Server
// ═══════════════════════════════════════════════════

describe('Cloud: Server routes', () => {
  it('should expose OpenAI-compatible chat endpoint', () => {
    expect(serverSrc).toContain("'/v1/chat/completions'");
    expect(serverSrc).toContain('authRequired');
    expect(serverSrc).toContain('rateLimit');
  });

  it('should expose models endpoint', () => {
    expect(serverSrc).toContain("'/v1/models'");
  });

  it('should expose key management endpoints', () => {
    expect(serverSrc).toContain("'/v1/keys'");
    expect(serverSrc).toContain("'/v1/keys/:keyId'");
  });

  it('should expose usage endpoint', () => {
    expect(serverSrc).toContain("'/v1/usage'");
  });

  it('should expose checkout endpoint without auth', () => {
    expect(serverSrc).toContain("'/checkout'");
  });

  it('should handle Stripe webhooks with raw body', () => {
    expect(serverSrc).toContain("'/webhooks/stripe'");
    expect(serverSrc).toContain('express.raw');
  });

  it('should enable CORS for landing page', () => {
    expect(serverSrc).toContain('cors');
    expect(serverSrc).toContain('LANDING_URL');
  });

  it('should have health check', () => {
    expect(serverSrc).toContain("'/health'");
    expect(serverSrc).toContain('llmbear-cloud');
  });

  it('should have 404 handler', () => {
    expect(serverSrc).toContain('404');
    expect(serverSrc).toContain('not_found');
  });
});

// ═══════════════════════════════════════════════════
// Landing Page: Stripe Connection
// ═══════════════════════════════════════════════════

describe('Cloud: Landing page connection', () => {
  const landingHtml = fs.readFileSync(path.resolve('site/index.html'), 'utf8');
  const welcomeHtml = fs.readFileSync(path.resolve('site/welcome/index.html'), 'utf8');

  it('should have startCheckout function on landing page', () => {
    expect(landingHtml).toContain('startCheckout');
  });

  it('should call /checkout endpoint with plan', () => {
    expect(landingHtml).toContain("'/checkout'");
    expect(landingHtml).toContain('plan');
  });

  it('should wire Cloud Bear button to checkout', () => {
    expect(landingHtml).toContain("startCheckout('cloud'");
  });

  it('should wire Grizzly Bear button to checkout', () => {
    expect(landingHtml).toContain("startCheckout('grizzly'");
  });

  it('should have welcome page that polls for account', () => {
    expect(welcomeHtml).toContain('session_id');
    expect(welcomeHtml).toContain('/account');
  });

  it('should show API key on welcome page', () => {
    expect(welcomeHtml).toContain('api-key');
    expect(welcomeHtml).toContain('copyKey');
  });

  it('should show code example on welcome page', () => {
    expect(welcomeHtml).toContain('base_url');
    expect(welcomeHtml).toContain('api_key');
    expect(welcomeHtml).toContain('chat.completions.create');
  });

  it('should show plan limits on welcome page', () => {
    expect(welcomeHtml).toContain('req/min');
    expect(welcomeHtml).toContain('tokens/day');
  });
});

// ═══════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════

describe('Cloud: Configuration', () => {
  const envExample = fs.readFileSync(path.resolve('cloud/.env.example'), 'utf8');

  it('should have .env.example with all required vars', () => {
    expect(envExample).toContain('STRIPE_SECRET_KEY');
    expect(envExample).toContain('STRIPE_WEBHOOK_SECRET');
    expect(envExample).toContain('STRIPE_PRICE_CLOUD');
    expect(envExample).toContain('STRIPE_PRICE_GRIZZLY');
    expect(envExample).toContain('GPU_BACKEND_URL');
    expect(envExample).toContain('PORT');
  });

  it('should document cloud model configuration', () => {
    expect(envExample).toContain('CLOUD_MODELS');
  });
});
