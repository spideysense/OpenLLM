# Aspen — Project Handoff & Architecture

_Last updated: 2026-06-10. Keep this current — update when architecture, major features, or known-bug patterns change. A future LLM reading this should be able to pick up development without repeating the mistakes below._

Aspen is **private AI that runs on your own hardware**. Free desktop app (Mac/Windows), free iPhone app, and a dedicated **$10K hardware device** (preorder). Nothing leaves the user's machine. Positioning: democratize AI so every home has its own local AI, like every home has a PC and phone.

- **Repo:** github.com/spideysense/OpenLLM (public; product is "Aspen", repo name is legacy)
- **Site:** runonaspen.com (Vercel) · **App (web/mobile):** runonaspen.com/app
- **iOS:** "Aspen Local AI", bundle `com.runonaspen.app`, app ID `6775307566`
- **Apple Team ID:** S6UBG93XBS · **Git identity:** Mayank Mehta <mayank.mehta@gmail.com>
- **Tunnel:** https://c5pvto71.runonaspen.com (Cloudflare named tunnel, stable URL)
- **Upstash KV:** choice-bird-73532.upstash.io

---

## ⚠️ CRITICAL: READ BEFORE TOUCHING ANYTHING

### The Three Chat Surfaces — Always Build 3×
Every chat feature must exist in **all three places**. Forgetting one is the most common source of bugs.

1. **Desktop (Electron React):** `src/renderer/pages/Chat.jsx`
2. **Web app:** `site/app/index.html` (vanilla JS, served at runonaspen.com/app)
3. **Mobile (Capacitor):** `mobile/www/index.html` (vanilla JS)

### The Store Allowlist — Any New Store Keys Must Be Added
`src/main/index.js` has `STORE_ALLOWLIST`. If a renderer tries to call `bridge.store.set(key, value)` and `key` is not in that set, the write is **silently blocked**. The symptom: settings that reset on every restart. **Before adding any new persistent setting, add its key to `STORE_ALLOWLIST`.**

Current allowlist: `onboarded`, `activeModel`, `totalExchanges`, `theme`, `windowBounds`, `worldModel`, `computerUseOnboarded`, `customInstructions`, `dismissedUpgrades`.

### CORS — gateway.js Must Allow www
The gateway CORS check must include BOTH `https://runonaspen.com` AND `https://www.runonaspen.com`. The site redirects to www. Forgetting www breaks the web app and phone app entirely for all users. Also allow `*.runonaspen.com` subdomains (tunnel URLs). See the CORS section in `src/main/gateway.js`.

### The Upstash KV SET Format
Upstash REST API SET: `POST /set/<key>` with `Content-Type: application/json` and the value as the raw JSON body (do NOT `JSON.stringify` twice). GET returns `j.result` which may be a string (parse it) or already an object (use as-is). The `parse()` helper in `api/community-savings.js` handles both cases and double-encoded strings from legacy data.

### The Release Script — Always Pass Version as CLI Arg
```bash
npm run release:mac -- 0.4.XX
```
Do NOT use `npm version X.Y.Z` before running the script — the script handles versioning internally (reads from CLI arg, applies with `npm version`, commits, pushes). Old approach of `npm version` before the script caused the version to be discarded by `git checkout -- package.json` inside the script.

---

## ARCHITECTURE OVERVIEW

### Desktop Backend (Electron main) — `src/main/`
| File | Purpose |
|---|---|
| `index.js` | IPC handlers, app wiring, store allowlist |
| `ollama.js` | Ollama lifecycle, `getModelCapabilities()` (uses /api/show) |
| `agent.js` | Desktop agent loop (Electron context, uses desktopCapturer) |
| `gateway-agent.js` | **HTTP gateway agent loop** (no Electron deps, CLI screenshot) |
| `gateway.js` | OpenAI-compatible API on :4000, `/v1/agent` endpoint |
| `tools.js` | Tool registry: web_search, calculate, get_datetime, fetch_url, run_command, deep_research |
| `computer-use.js` | Computer use (desktop only): desktopCapturer + robotjs/osascript |
| `tool-settings.js` | Reads/writes tool enabled state from electron-store |
| `apikeys.js` | API key generation, validation, `isOwnerKey()` |
| `tunnel.js` | Cloudflare named tunnel management |
| `skills.js` | Skills system (requires Electron app.getPath — do NOT use in gateway) |
| `world-model.js` | World model memory |
| `updater.js` | Auto-update via electron-updater |

### Vercel Endpoints — `api/`
| File | Purpose |
|---|---|
| `proxy.js` | Legacy chat proxy → `/v1/chat/completions` (kept for compatibility) |
| `agent.js` | **New** chat proxy → `/v1/agent` (web+mobile use this, gets tools) |
| `community-savings.js` | POST/GET savings data in Upstash KV |
| `admin-stats.js` | Admin dashboard data (GitHub downloads, visits, trial) |
| `trial.js` | Cloud trial (limited free messages) |
| `tunnel-provision.js` | Issues Cloudflare tunnel tokens |
| `preorder-checkout.js` | Stripe checkout for $10K device ($1 deposit) |

### Chat Routing
```
Desktop:  Chat.jsx → IPC → index.js → agent.js (tool loop) → Ollama
Web/Mobile: site/app/index.html → /api/agent (Vercel) → tunnel → gateway:4000/v1/agent → gateway-agent.js (tool loop) → Ollama
```
Web and mobile apps now get full tool support (web_search, calculate, run_command, computer_use) via the `/v1/agent` endpoint.

---

## THE /v1/agent ENDPOINT (added 2026-06-10)

### What it does
The gateway's `/v1/agent` route runs the full agent loop server-side. Web and mobile clients call `/api/agent` on Vercel, which proxies to `/v1/agent` on the user's Aspen machine via the tunnel. Result: every tool (web search, calculator, run_command, computer use) works from the browser and phone.

### Security model
- **Safe tools** (available to all valid API key holders): `web_search`, `calculate`, `get_datetime`, `fetch_url`, `deep_research`
- **Dangerous tools** (owner key only): `run_command`, `computer_screenshot`, `computer_click`, `computer_type`, `computer_key`, `computer_scroll`
- `isOwnerKey(authToken)` gate in gateway.js → passed as `isOwner` to gateway-agent → enforced in `executeAnyTool`

### Screenshot implementation
`gateway-agent.js` uses CLI, NOT Electron:
- Mac: `screencapture -x -t png /tmp/aspen-ss-*.png`
- Win: PowerShell CopyFromScreen
- Linux: gnome-screenshot / scrot / import fallback
- Temp file always deleted in `finally`

### Computer tool definitions
The desktop `computer-use.js` uses Anthropic `input_schema` format. The gateway uses OpenAI `parameters` format (what Ollama actually understands). These are defined in `GATEWAY_COMPUTER_TOOL_DEFS` in `gateway-agent.js`. **Do not confuse the two formats.**

---

## BUILD & RELEASE

### Mac release (the only path — signing cert is on local Mac only)
```bash
cd ~/aspen
git pull && npm install
export APPLE_ID="mayank.mehta@gmail.com"
export APPLE_APP_SPECIFIC_PASSWORD="<app-specific-pw>"
export APPLE_TEAM_ID="S6UBG93XBS"
export GH_TOKEN="<GitHub PAT>"
npm run release:mac -- 0.4.XX   # version as CLI arg
```

### What the release script does
1. `git checkout -- package-lock.json package.json` (discards local changes)
2. `git pull` (gets latest code)
3. `npm version X.Y.Z --no-git-tag-version` (bumps version from CLI arg)
4. Commits + pushes version bump (so Windows workflow sees correct version)
5. `electron-rebuild` (rebuilds native modules for Electron)
6. Smoke test (boots app, checks renderer renders)
7. Build DMG with `--publish never`
8. Notarize + staple (DMG is stapled BEFORE upload — prevents "Aspen is damaged")
9. Validate staple with `xcrun stapler validate`
10. Upload to GitHub releases
11. Verify `/releases/latest` serves the new version
12. Trigger Windows EXE build via GitHub Actions

### Why the Windows workflow matters
The Windows workflow checks out the repo and uses `package.json` version. If the version commit wasn't pushed before the workflow runs, it builds with the wrong version, creates a stale release, GitHub marks it "latest", and auto-updates break for all users. **Step 4 above (commit+push version) exists specifically to prevent this.**

### Auto-update
- electron-updater watches GitHub releases `/latest`
- `latest-mac.yml` and `latest.yml` must always point to the current version
- Never leave a rogue release with a higher `created_at` than the real latest (it becomes "latest")
- To delete a bad release: there's a `delete-release.yml` GitHub Actions workflow

---

## KNOWN BUG PATTERNS — DO NOT REPEAT

Every bug below was found in production. Tests in `tests/critical/` guard against regression.

### 1. CORS: www vs non-www
**Symptom:** web app and phone app show "offline" even when tunnel is connected.
**Cause:** `gateway.js` CORS allowed `https://runonaspen.com` but not `https://www.runonaspen.com`. The site loads at www.
**Fix:** Allow both, plus `*.runonaspen.com` subdomains. See `src/main/gateway.js`.
**Test:** `tests/critical/gateway-cors.test.js`

### 2. Store allowlist blocking new settings
**Symptom:** a setting (like computer use onboarding seen flag) resets every launch.
**Cause:** `bridge.store.set(key, value)` is silently blocked for keys not in `STORE_ALLOWLIST`.
**Fix:** Add new keys to `STORE_ALLOWLIST` in `src/main/index.js`.
**Test:** `tests/critical/regressions.test.js`

### 3. Upstash KV 500 errors
**Symptom:** community savings API returns 500.
**Cause:** Wrong KV SET format. Use `POST /set/<key>` with raw JSON body. Do NOT JSON.stringify the value twice.
**Fix:** `body: value` (not `body: JSON.stringify(value)`) where value is already a JSON string.
**Test:** `tests/critical/community-savings.test.js`

### 4. Version mismatch in builds (stale code shipped)
**Symptom:** built app doesn't have the latest features; JS bundle hash unchanged across builds.
**Cause:** `git pull` was blocked by `package.json` local changes. OR version passed to `npm version` was discarded by the release script's own `git checkout`.
**Fix:** Release script now does `git checkout -- package-lock.json package.json` before pull, then applies version from CLI arg. `git pull` always succeeds.
**Test:** `tests/critical/regressions.test.js`

### 5. Windows workflow creating rogue releases
**Symptom:** auto-updates break; GitHub `/releases/latest` points to a wrong version.
**Cause:** Windows workflow checked out repo with stale `package.json` (version was changed locally but not committed), built with that wrong version, created a new release that GitHub marked "latest".
**Fix:** Release script commits version bump before Windows workflow runs.
**Test:** `tests/critical/regressions.test.js`

### 6. robotjs in `dependencies` breaking Vercel
**Symptom:** all Vercel deploys fail (robotjs native compile error).
**Fix:** robotjs must be in `optionalDependencies`, not `dependencies`.
**Test:** `tests/critical/regressions.test.js`

### 7. Send button sending previous message
**Symptom:** clicking the send button in web/mobile replays the last message instead of sending the current input.
**Cause:** `sendBtn.addEventListener('click', sendMessage)` — the click event is passed as the `autoRespond` arg, which is truthy, so `sendMessage` skips reading the input box.
**Fix:** `sendBtn.addEventListener('click', () => sendMessage())` — arrow wrapper.
**Test:** `tests/critical/regressions.test.js`

### 8. Community savings rate-limiting blocking updates
**Symptom:** "Share with community" succeeds once but never updates; website shows stale number.
**Cause:** old API had a 24h per-IP rate limit. Users sharing again (with updated savings) were silently blocked.
**Fix:** New API is pure append, no IP tracking, no rate limit.
**Test:** `tests/critical/community-savings.test.js`

### 9. Computer Use onboarding modal appearing every launch
**Symptom:** "Aspen can control your computer" modal shows every time the app starts.
**Cause:** `bridge.store.set('computerUseOnboarded', true)` was silently blocked by the store allowlist (see bug #2).
**Fix:** Added `computerUseOnboarded` to `STORE_ALLOWLIST`.
**Test:** `tests/critical/regressions.test.js`

### 10. DMG uploaded before stapling ("Aspen is damaged" for users)
**Symptom:** macOS shows "Aspen is damaged and can't be opened" after download.
**Cause:** DMG was uploaded to GitHub before the staple step ran.
**Fix:** Release script validates staple with `xcrun stapler validate` BEFORE any upload.
**Test:** `tests/critical/stapling.test.js`

### 11. Vercel streaming buffering (504 / no live tokens)
**Symptom:** chat responses don't stream; 504 on long responses.
**Cause:** `start()` in `ReadableStream` was `async` and awaited work, causing Vercel to buffer the entire response.
**Fix:** `start()` must be synchronous. Flush `': connected\n\n'` immediately. Run the upstream fetch in a detached `(async()=>{...})()`. 8s heartbeat comments.
**Applied in:** `api/proxy.js`, `api/agent.js`, `api/trial.js`

---

## CRITICAL TESTS

Run before every push:
```bash
npx vitest run tests/critical/
```

Current: 108 tests across 8 files.

| File | What it guards |
|---|---|
| `gateway-cors.test.js` | CORS allows www, subdomains, mobile origins; blocks evil.com |
| `regressions.test.js` | One test per production bug — all the patterns above |
| `community-savings.test.js` | POST/GET roundtrip, no rate limit, large numbers, legacy data |
| `gateway-agent.test.js` | /v1/agent endpoint, computer tool format, security, CLI screenshot |
| `tunnel.test.js` | Tunnel module contract, web app offline detection |
| `stapling.test.js` | Staple before upload, version commit, CLI arg |
| `tool-calling.test.js` | Tool registration, execution, security gating |
| `sharing.test.js` | App sends right fields, no IP tracking, POST/GET roundtrip |

---

## MODEL CAPABILITY DETECTION (added 2026-06-10)

`src/main/ollama.js` exports `getModelCapabilities(modelName)`:
1. Calls Ollama `/api/show` → reads `capabilities` array (`["completion", "tools", "vision"]`)
2. Falls back to name-based heuristics if `/api/show` fails
3. Returns `{ tools: bool, vision: bool }`

**Used in `App.jsx`:**
- `modelCaps.tools` = false → red banner, all tools disabled
- `modelCaps.tools` + `modelCaps.vision` = true → Computer Use onboarding offered once
- `computer_use` auto-enabled/disabled based on vision capability

**In Settings:**
- Computer Use toggle hidden if model lacks vision
- All tool toggles greyed if model has no tool support
- Status badge shows green "✅ supports tools" or red warning

---

## COMMUNITY SAVINGS

The "Share with community" feature on the Home screen lets users anonymously contribute their savings stats to a public counter on runonaspen.com.

**Data model:** Upstash KV
- `savings:totals` → `{total, exchanges, shares}` — running aggregate
- `savings:recent` → array of last 50 entries for the recent feed

**No rate limiting. No IP tracking.** Users can share as many times as they want — it's marketing, not accounting.

**API:** `api/community-savings.js` on Vercel

**Site widget:** reads `GET /api/community-savings` and displays total + count.

---

## SEO / AEO

- `site/index.html`: JSON-LD (Organization, SoftwareApplication, MobileApplication, FAQPage, HowTo), OG/Twitter cards
- `site/llms.txt`: AEO file for AI crawlers
- Style rules: NO em-dashes. First-person founder voice.
- **After every user-facing feature: update site/index.html + site/llms.txt**

---

## CURRENT VERSION

- Latest release: v0.4.35 (as of 2026-06-10)
- Next planned: v0.4.36 (pending build — includes CORS fix, gateway agent, computer use onboarding fix, savings fix)

## PREORDER

Stripe checkout: `api/preorder-checkout.js`
- $10K full price OR $299/mo × 36 months
- Both require $1 deposit at checkout
- Success handler: `api/preorder-success.js` (sends confirmation email with plan details)

---

## OWNER vs GUEST KEYS (added 2026-06-10)

API keys now have two types, chosen via radio at creation (`src/renderer/pages/APIKeys.jsx`):
- **Owner key** (`owner: true`): computer use (screen control), shared memory (World Model), all tools. The Default key is always owner.
- **Guest key** (`owner: false`): reasoning engine + safe tools (web search, calculator) only. No computer use, no memory access, ephemeral.

Enforced in `gateway-agent.js` (`executeAnyTool` checks `isOwner` for DANGEROUS_TOOLS) and `gateway.js` `/v1/world-model` route (guests get `{facts:[], owner:false}`).

## FAST PATH (added 2026-06-10)

`gateway-agent.js` `run()` has a fast path: `messageNeedsTools()` checks the message against `TOOL_TRIGGERS` regexes. If no tool is needed (most messages), it streams straight from Ollama via `ollamaStream()` — instant. Only tool-triggering messages go through the slower non-streaming agent loop. This fixed the "every web/mobile message is wicked slow" problem (previously every message did a non-streaming agent round-trip).

## WORLD MODEL SYNC (added 2026-06-10)

The World Model (memory) lives on the Aspen machine. Web/mobile owner-key clients read it via `/api/world-model` (Vercel) → `/v1/world-model` (gateway). Owner-gated: guests get empty. Chat history is still local per-device (deferred — see git history for the scope decision). Memory was previously blank in the web app because it fetched the wrong URL (`/world-model` instead of `/v1/world-model`) and bypassed the proxy.
