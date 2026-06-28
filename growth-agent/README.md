# Aspen Growth Agent

A self-improving growth agent that runs 24/7 on your Aspen box. It does the
grunt work of growth — research, audits, drafting, monitoring — **learns which
tactics actually drive installs**, and queues every publish action for one-tap
human approval. Inference runs on the box, so the loop is free.

Goal it optimizes toward: **net new downloads/day (App Store + web)**.

## Why it's built this way (read this first)

- **The iOS app is a companion to the Mac app.** Downloads that stick come from
  the local-AI crowd who have a capable Mac, not generic "AI chatbot" searchers.
  Every prompt is grounded in that truth (`src/config.js → PRODUCT`) so the agent
  never writes inaccurate copy or chases the wrong audience.
- **It drafts; you publish.** Automated posting to Reddit/HN/Product Hunt gets you
  banned and is the fastest way to torch the brand. The agent prepares everything
  up to the publish click; a human sends it. `ALLOW_AUTOPUBLISH=false` is the
  default and only ever applies to channels you own (your own site/SEO).
- **It's a learner, not a firehose.** Tactics are scored by *measured downloads
  per attempt* (`src/playbook.js`, a UCB1 bandit). Tell it the result of a shipped
  action and it shifts effort toward what works — so it gets sharper, not busier.

## The loop

```
collect (App Store, Reddit, HN, GitHub, GSC)   → data/metrics
  → analyze vs goal + past outcomes (on the box)
    → draft research / replies / audits / listing changes
      → APPROVAL QUEUE (Slack)  ── human approves & publishes
        → report result  → playbook learns  → better next pick
```

## Functions (cron, all runnable on demand)

| function | cadence | what it does |
|---|---|---|
| `pulse` | daily | snapshot App Store rating/reviews, GitHub stars, (wire in real downloads); compute deltas |
| `radar` | 2×/day | scan r/LocalLLaMA, r/selfhosted, r/macapps, HN for buying-intent; draft honest helpful replies → queue |
| `aso` | weekly | read live listing + reviews; propose title/subtitle/keywords/screenshots → queue |
| `strategy` | weekly | the brain: diagnose vs goal, pick the week's 3 highest-leverage actions, weighted by what's worked |
| `outcome` | on event | you report downloads from a shipped action → the playbook updates |

## Run it

```bash
npm install
cp .env.example .env      # set ASPEN_BASE_URL + ASPEN_API_KEY (the box tunnel)

# run any function once (great as a plain box cron):
node src/cli.js pulse
node src/cli.js radar
node src/cli.js aso
node src/cli.js strategy
node src/cli.js queue              # show pending proposals
node src/cli.js rank               # show tactic scores (what's working)
node src/cli.js outcome reddit_localllama 40   # teach it: that reply drove 40 dls

# or run the Inngest server for managed cron + retries:
npm run serve                      # exposes /api/inngest
```

Minimal setup needs only the two `ASPEN_*` vars. Everything else is optional and
makes it sharper: `SLACK_WEBHOOK_URL` (digest + approvals), `GITHUB_TOKEN` (repo
traffic), `GSC_CREDENTIALS_JSON` + `GSC_SITE_URL` (search performance).

## Wire in real download numbers

The strategist optimizes against `metrics[].downloads`, currently `null`. Feed it
truth from **App Store Connect** (Sales & Trends / the App Store Connect API) and
your **web analytics** (Plausible/GA), and set `downloads` in `src/agents/pulse.js`.
Until then it reasons from proxies (ratings count, stars) — useful, but the real
numbers make the learning loop bite.

## Storage

Ships with a zero-infra JSON store (`src/store.js`, writes `./data/*.json`) so it
runs immediately. Swap in Supabase/Postgres by reimplementing `load/save/push`.

## Hard rules

- Never auto-posts to a third-party platform. Approval queue is mandatory.
- Honesty in drafts (discloses it's your project; upfront that iOS needs the Mac app).
- Heavy LLM jobs are scheduled off-peak so they don't starve real users on the box.
