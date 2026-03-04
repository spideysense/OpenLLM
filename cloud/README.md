# LLM Bear Cloud

Multi-tenant AI gateway with Stripe billing. Gives every paying user their own API key to a shared GPU pool running open source models.

## Architecture

```
User → Stripe Checkout → Webhook → Provision User + API Key
                                          ↓
User's code → cloud/server.js (auth + rate limit) → GPU Backend (Ollama/vLLM/RunPod)
              port 4001                               port 11434
```

**Flow:**
1. User clicks "Start for $0.99/mo" on landing page
2. Landing page POSTs to `/checkout` → creates Stripe Checkout session → redirects
3. User pays → Stripe fires `checkout.session.completed` webhook
4. Webhook provisions user in SQLite, auto-generates API key
5. User lands on `/welcome?session_id=...` → sees their API key + code example
6. User's code hits `/v1/chat/completions` with `Bearer sk-bear-...`
7. Server validates key, checks plan limits, forwards to GPU backend, tracks usage

## Plans

| Plan | Price | RPM | Daily Tokens | Cloud Access |
|------|-------|-----|-------------|-------------|
| Cave Bear | Free | — | — | Local only |
| Cloud Bear | $0.99/mo | 30 | 500K | Yes |
| Grizzly Bear | $1.99/mo | 60 | 2M | Yes |

## Setup

```bash
cd cloud
cp .env.example .env    # edit with your Stripe keys
npm install
npm start               # runs on port 4001
```

### Stripe Setup

1. Create a Stripe account at stripe.com
2. Create two recurring products/prices:
   - Cloud Bear: $0.99/month → copy the `price_xxx` ID
   - Grizzly Bear: $1.99/month → copy the `price_xxx` ID
3. Create a webhook endpoint pointing to `https://your-server.com/webhooks/stripe`
   - Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
4. Copy the webhook signing secret (`whsec_xxx`)
5. Fill in `.env`

### GPU Backend

Point `GPU_BACKEND_URL` at any OpenAI-compatible API:

- **Ollama (local):** `http://127.0.0.1:11434/v1` (default)
- **vLLM:** `http://gpu-server:8000/v1`
- **RunPod Serverless:** `https://api.runpod.ai/v2/xxx/openai/v1`
- **Modal:** Your Modal endpoint URL

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/checkout` | No | Create Stripe checkout session |
| GET | `/account` | No | Get account info (via session_id) |
| POST | `/webhooks/stripe` | Stripe sig | Handle Stripe events |
| POST | `/v1/chat/completions` | Bearer | OpenAI-compatible chat |
| GET | `/v1/models` | Bearer | List available models |
| GET | `/v1/keys` | Bearer | List API keys |
| POST | `/v1/keys` | Bearer | Create new API key |
| DELETE | `/v1/keys/:id` | Bearer | Revoke API key |
| GET | `/v1/usage` | Bearer | Usage summary |

## Model Aliases

Users can send familiar model names — the gateway routes them:

| Alias | Routes To |
|-------|-----------|
| gpt-4, gpt-4o | qwen2.5:7b |
| gpt-3.5-turbo, gpt-4o-mini | llama3.2:3b |
| claude-3.5-sonnet | qwen2.5:7b |
| o1, o1-mini | deepseek-r1:7b |

## Deploy

Recommended: **Fly.io** or **Railway** for the gateway, with GPU backend on RunPod/Modal.

```bash
# Fly.io example
fly launch --name llmbear-cloud
fly secrets set STRIPE_SECRET_KEY=sk_live_xxx ...
fly deploy
```

## License

MIT
