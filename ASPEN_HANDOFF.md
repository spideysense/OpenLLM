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

The live reasoning trail (status + tool steps) now exists on all three: web/mobile read `aspen_status`/`aspen_tool` off the gateway SSE; desktop gets them from `agent.runAgent({onEvent})` → `chat:send` IPC → `chat:stream` chunks carrying `aspen_status` → the `ReasoningTrail` component in Chat.jsx. Guarded by `tests/critical/ssrf-and-auth.test.js`.

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

### ⚠️ Electron 42 upgrade (2026-06-12) — VERIFY ON THE MAC BEFORE SHIPPING
Upgraded Electron 28 → 42 (Chromium M148, Node 24). Electron 28 had been EOL since
Jun 2024 (no Chromium security backports). What changed:
- `electron` ^28 → ^42.4.0, `electron-builder` ^24 → ^26.15.3, `@electron/rebuild`
  ^3 → ^4.0.4, `electron-updater` ^6.8.3 → ^6.8.9, `better-sqlite3` (dev) → ^12.10.0.
- **robotjs removed** (abandoned, won't build on E42/Node 24). Computer Use is now
  osascript (Mac) / PowerShell (Win) only — the fallback paths that already existed.
  `asarUnpack` for robotjs removed; `loadRobot()` is a no-op returning false.
- **`NSMicrophoneUsageDescription` added** to the mac build via `extendInfo`. The app
  calls `systemPreferences.askForMediaAccess('microphone')` on launch, which crashes
  on modern macOS without this Info.plist string — a latent bug E42 would expose.
- CI workflows bumped to Node 22.
- **Why this was low-risk despite being 14 majors:** the app already uses the modern
  setup (contextIsolation + preload + contextBridge), calls `desktopCapturer` in the
  MAIN process (the big E17/E30 change doesn't apply), and uses no removed APIs. The
  work was almost entirely dependency/build-tooling, not API rewrites.
- **Still required (cannot be done in CI / sandbox):** on the Mac, `git pull && npm
  install` (this downloads the E42 binary + rebuilds `sharp` for the new ABI), then
  `npm run release:mac -- 0.4.43`. The release script's smoke test (boots the real
  app, checks the renderer mounts) is the gate — if it passes, the runtime is healthy.
  Sanity-check after launch: voice mic prompt appears (not a crash), Computer Use can
  screenshot+click, auto-update still detects releases.
- Guard tests: `tests/critical/dependencies.test.js`.

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

### 12. SSRF via fetch_url / web_search (2026-06-12)
**Symptom (latent):** any valid key — including low-trust family/guest keys — could call `fetch_url` over the public tunnel pointed at `169.254.169.254` (cloud metadata), `127.0.0.1`, or LAN addresses and read the internal response.
**Cause:** `fetchText()` in `tools.js` fetched any URL with no address validation and followed redirects (so a public URL could redirect to an internal one).
**Fix:** `hostIsBlocked()` rejects literal private/loopback/link-local/reserved hosts up front; a pinned `safeLookup()` DNS resolver rejects hostnames that *resolve* to those ranges and is re-checked on every redirect hop (closes the DNS-rebind window). Non-http(s) protocols rejected.
**Tradeoff:** the owner can no longer fetch their own `localhost` dev server through the chat tools — use `run_command` + curl for that, or ask to add an owner-only allowlist.
**Test:** `tests/critical/ssrf-and-auth.test.js`

### 13. Revoking the last API key dropped the gateway into open mode (2026-06-12)
**Symptom (latent):** `validateKey()` returns `true` for ANY token when zero keys exist ("open mode"). Revoking the last key via the UI therefore disabled authentication on the tunnel-facing gateway.
**Cause:** `revokeKey()` could leave the key store empty; open mode is intended only for first-run-before-default-key.
**Fix:** `revokeKey()` now fails closed — if removing a key would empty the store it mints a fresh Default owner key and returns `{ regenerated:true, newKey }`. Open-mode semantics (first run) are unchanged.
**Test:** `tests/critical/ssrf-and-auth.test.js`, updated `tests/main/core.test.js`

### 14. /api/debug.js leaked the tunnel base URL unauthenticated (2026-06-12)
**Symptom (latent):** the public `api/debug.js` endpoint returned `MONET_BASE_URL` (the front door to the owner's machine) and proxied a live chat through it, with no auth.
**Fix:** gated behind `ADMIN_PASSWORD` (header `x-admin-password`, query `?password=`, or JSON body); base URL redacted to a host suffix; 401 without the password.
**Test:** `tests/critical/ssrf-and-auth.test.js`

### 15. Brute-force lockout bypass via X-Forwarded-For rotation (2026-06-12)
**Symptom (latent):** the per-IP rate limit and 10-fail auth lockout keyed off the client-controlled first `x-forwarded-for` value, so rotating that header defeated both.
**Fix:** prefer Cloudflare's `cf-connecting-ip` (set by the tunnel, overwrites client values), then XFF, then socket.
**Test:** `tests/critical/ssrf-and-auth.test.js`

### 16. Computer use silently dead on DESKTOP — wrong tool-def format (2026-06-12)
**Symptom:** computer use never worked in the desktop app — the model never clicked/typed/screenshotted.
**Cause:** `computer-use.js` defines `COMPUTER_TOOLS` in Anthropic `input_schema` shape. The desktop agent passes them straight to Ollama via `getToolDefinitions()`, but Ollama only understands the OpenAI `{type:'function', function:{name, parameters}}` shape. The malformed defs were ignored, so the model never received usable computer tools. (The gateway path worked only because it has its own `GATEWAY_COMPUTER_TOOL_DEFS` in OpenAI shape.)
**Fix:** `getToolDefinitions()` now translates computer tools to OpenAI shape before returning. `executeTool` routing and the osascript/PowerShell fallbacks were already correct.
**Still required by the user:** macOS Screen Recording + Accessibility permissions (granted once in System Settings). Those can't be fixed in code.
**Test:** `tests/critical/ssrf-and-auth.test.js` (OpenAI-format assertion)

### 17. "Update ready" button did nothing — two updaters share one banner (2026-06-12)
**Symptom:** clicking the "Update ready — click to restart & update" banner did nothing.
**Cause:** TWO update systems push to the same banner — `updater.js` (full-app, electron-updater, `source:'app'`) and `hot-updater.js` (renderer-only via runonaspen.com, `source:'hot'`). The banner click was hardwired to `updater.install()`, which silently no-ops unless electron-updater itself downloaded a full build (`updateReady`). When the 'ready' came from the hot-updater (which already reloads the renderer in place), the click hit the wrong installer and did nothing — with zero feedback.
**Fix:** tag each updater's status with `source`; the Sidebar dispatches the click — `hot` → `hotUpdater.reload()`, `app` → `updater.install()`. `installUpdate()` now returns a result; on not-downloaded/failure the Sidebar falls back to `updater.openReleasesPage()` (opens the latest GitHub release) so the click is never dead. Banner label is source-aware (reload vs restart).
**Note:** a build already installed with the OLD code can't self-fix — install the new build manually once (from `/releases/latest`); updates work after that.
**Test:** `tests/critical/update-button.test.js`

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
| `ssrf-and-auth.test.js` | SSRF guard, fail-closed key revocation, debug auth gating, XFF-resistant rate limit, web↔mobile reasoning-trail parity |

Full suite total: 529 passing (run `npx vitest run`, not just `tests/critical/`).

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

---

## PER-KEY MEMORY (added 2026-06-11)

Each API key has its own isolated World Model (memory). The key IS the identity — memory follows the key across that user's devices (iPhone + web both see the same memory), stored server-side on the Aspen machine.

**Three key types** (radio at creation in APIKeys.jsx):
- **Owner** (`owner:true`): computer use + own memory + all tools. Default key is owner. Memory stored at legacy `worldModel` key.
- **Family/Member** (`memory:true, owner:false`): own private memory (`worldModel:{keyId}`) + chat + safe tools. NO computer use. For Ashini/Anjali/Anoushka.
- **Anonymous guest** (`memory:false`): reasoning + safe tools only. No memory, ephemeral.

**Key functions:**
- `world-model.js`: every fn takes optional `keyId`. `storeKeyFor(keyId)`: 'owner'/undefined→'worldModel' (back-compat), other→'worldModel:{keyId}', null→null (no memory).
- `apikeys.js`: `memoryKeyFor(token)` → 'owner' | keyId | null. `createKey(label, {owner, memory})`.
- `gateway-agent.js`: `run({memoryKeyId})` injects that user's memory into the system prompt (both fast + tool paths) and extracts facts to it after replies.
- `gateway.js`: resolves `memoryKeyId = apikeys.memoryKeyFor(authToken)`, passes to agent. `/v1/world-model` returns the caller's OWN memory (`hasMemory` flag).

**Computer use stays owner-only** — family members get memory but can't control the Mac Studio screen (enforced via `isOwner` gate in `executeAnyTool`).

**Desktop app** = always owner (calls world-model without keyId → defaults to 'owner', back-compat preserved).

**Testing note:** vitest can't reliably mock `world-model.js`'s CommonJS `require('./store')` from an ESM test (dual module instances). Tests use the real in-memory store and clear slices via `worldModel.clearMemory(keyId)`, which uses the same store instance world-model reads/writes.
