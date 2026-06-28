// Central config + product truth. The product facts are injected into every
// LLM prompt so the agent never writes something inaccurate (App Store rejects
// misleading copy, and the r/LocalLLaMA crowd smells fluff instantly).
try { await import('dotenv/config'); } catch { /* env injected by host */ }

export const cfg = {
  aspen: {
    baseUrl: process.env.ASPEN_BASE_URL || 'http://localhost:4000/v1',
    apiKey: process.env.ASPEN_API_KEY || '',
    model: process.env.ASPEN_MODEL || 'local',
  },
  goalPerDay: Number(process.env.GOAL_DOWNLOADS_PER_DAY || 10),
  userAgent: process.env.USER_AGENT || 'aspen-growth-agent/0.1',
  githubRepo: process.env.GITHUB_REPO || 'spideysense/OpenLLM',
  githubToken: process.env.GITHUB_TOKEN || '',
  appstoreId: process.env.APPSTORE_ID || '6775307566',
  slackWebhook: process.env.SLACK_WEBHOOK_URL || '',
  gsc: { credsPath: process.env.GSC_CREDENTIALS_JSON || '', site: process.env.GSC_SITE_URL || '' },
  allowAutopublish: String(process.env.ALLOW_AUTOPUBLISH || 'false') === 'true',
};

// The single source of truth about the product. Keep this honest.
export const PRODUCT = `
Aspen — private AI that runs on your own hardware.
- Free Mac/Windows desktop app (runonaspen.com) runs open LLMs (Llama, Qwen, DeepSeek...) 100% locally. No cloud, no account, no subscription.
- Free iPhone app "Aspen Local AI" is a COMPANION/CLIENT to the desktop app: it connects to the AI running on the user's own Mac. It does NOT run models on the phone by itself. It is useless without the desktop app installed.
- Optional dedicated Aspen device ($10k tier) for running the largest models 24/7. Almost nobody needs this.
- Open source (github.com/spideysense/OpenLLM).
Who actually converts and STAYS: people who want private/offline/local AI AND have a capable Mac (Apple Silicon). The local-LLM enthusiast crowd (r/LocalLLaMA, Hacker News, selfhosted, Ollama users) is the bullseye. Generic "AI chatbot" searchers will install the iOS app, discover they need a Mac, and bounce.
`.trim();

// Channels the agent reasons about, with hard rules. The agent DRAFTS for all of
// them; a human does the actual publish unless ALLOW_AUTOPUBLISH and the channel
// permits automation (most don't — automated posting = bans).
export const CHANNELS = [
  { id: 'reddit_localllama', name: 'r/LocalLLaMA', kind: 'community', autopublish: false, fit: 0.95 },
  { id: 'reddit_selfhosted', name: 'r/selfhosted', kind: 'community', autopublish: false, fit: 0.8 },
  { id: 'reddit_macapps', name: 'r/macapps', kind: 'community', autopublish: false, fit: 0.75 },
  { id: 'hackernews', name: 'Hacker News (Show HN)', kind: 'community', autopublish: false, fit: 0.85 },
  { id: 'producthunt', name: 'Product Hunt', kind: 'launch', autopublish: false, fit: 0.7 },
  { id: 'github', name: 'GitHub (README/topics/trending)', kind: 'owned', autopublish: false, fit: 0.8 },
  { id: 'aso', name: 'App Store listing (ASO)', kind: 'owned', autopublish: false, fit: 0.6 },
  { id: 'seo', name: 'Site SEO/AEO', kind: 'owned', autopublish: true, fit: 0.6 },
];
