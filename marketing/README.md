# Aspen Marketing Engine

Autonomous content generation that runs daily via GitHub Actions.

## How it works

1. **Daily at 7am PT**, the GitHub Action runs `scripts/marketing-engine.js`
2. Claude generates a **social post** (Twitter + LinkedIn + TikTok) and a **blog post**
3. Content is committed to this repo automatically
4. Blog posts go live on runonaspen.com via Vercel auto-deploy

## Content themes (rotated automatically)

| Angle | Example |
|---|---|
| Privacy | "Why your AI conversations should stay on your machine" |
| Cost | "I saved $500 this year by running AI locally" |
| Capability | "My local AI just built me a web app in 30 seconds" |
| Philosophy | "Your AI should belong to you" |
| How-to | "How to set up a private AI in 5 minutes" |
| Comparison | "Local AI vs ChatGPT: honest comparison" |

## File structure

```
marketing/
  queue/          ← Daily social posts (Twitter/LinkedIn/TikTok)
  posted.json     ← Tracks which topics have been used
site/blog/
  YYYY-MM-DD-slug.md  ← Auto-generated blog posts
```

## Manual trigger

Go to GitHub → Actions → "Daily Marketing Engine" → Run workflow

## Setup

Add these to GitHub Secrets (Settings → Secrets → Actions):
- `ASPEN_TUNNEL_URL` — your Cloudflare tunnel URL (e.g. `https://xqwppdrl.runonaspen.com`)
- `ASPEN_API_KEY` — your Aspen API key (e.g. `sk-aspen-...`)
- `ASPEN_MODEL` — (optional) model to use, defaults to `gemma4`

Your Aspen desktop app must be running for the Action to reach it through the tunnel. The marketing engine eats its own dogfood — powered by Aspen itself.

## Social posting

Social posts are saved to `marketing/queue/` as markdown files. Currently manual posting — future: auto-post via Twitter/LinkedIn APIs.
