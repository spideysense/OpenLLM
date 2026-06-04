# Aspen — Project Handoff & Architecture

_Last updated: 2026-06-04. Keep this current — update it when architecture or major features change._

Aspen is **private AI that runs on your own hardware**. Free desktop app (Mac/Windows), free iPhone app, and a dedicated **$10K hardware device** (preorder). Nothing leaves the user's machine. Positioning: democratize AI so every home can have its own local AI, the way every home has a PC and a phone. No single company should hold all of someone's personal, professional, health, financial, and family data.

- **Repo:** github.com/spideysense/OpenLLM (private; product is "Aspen", repo name is legacy)
- **Site:** runonaspen.com (Vercel) · **App (web trial):** runonaspen.com/app
- **iOS:** "Aspen Local AI", bundle `com.runonaspen.app`, app ID `6775307566`, App Store **APPROVED**
- **Apple Team ID:** S6UBG93XBS · **Git identity:** Mayank Mehta <mayank.mehta@gmail.com>

---

## CRITICAL OUTSTANDING ITEMS (do these)

1. **Rotate exposed credentials** (pasted in chat/screenshots, now compromised):
   - GitHub PAT, Apple app-specific password (`nrac-gska-vrof-kete`), all `sk-aspen-*` keys.
2. **Revoke the hardcoded iOS reviewer API key** `sk-aspen-usLjpMOWr8F9K6iSYed2_k37Eig0jPVJ` now that Apple approved (it's baked in the shipped iOS app for the reviewer demo).
3. **Verify the App Store link is publicly live:** `https://apps.apple.com/app/id6775307566` (used on site + PH; was never confirmed loading).
4. **Sitemap in Google Search Console:** resolve the www vs non-www mismatch — site redirects `runonaspen.com` → `www.runonaspen.com` but sitemap/canonical declare non-www. Fix in Vercel → Settings → Domains (set non-www primary) OR change sitemap+canonical to www. The file itself is valid.
5. **Cut the next DMG** to ship all the desktop work below (native tools, vision, artifacts panel, connectors, URL fetch). Released DMG is **v0.4.8** (Apple Silicon only, notarized+stapled). Desktop features below are committed but NOT yet in a released DMG beyond v0.4.8 — check git vs release tag.

---

## ARCHITECTURE OVERVIEW

### Three separate chat UIs (the #1 source of "works on one, not the others" bugs)
Every chat feature must be built **3×**. Consolidating these into one shared module is the big structural TODO.
1. **Desktop (Electron renderer):** `src/renderer/pages/Chat.jsx` (React)
2. **Mobile (Capacitor):** `mobile/www/index.html` (vanilla JS, in `~/aspen/mobile`)
3. **Web app:** `site/app/index.html` (vanilla JS) — served at runonaspen.com/app. **Easy to forget this one exists.**

### Desktop backend (Electron main) — `src/main/`
- `index.js` — IPC handlers, app wiring, chat routing decision
- `ollama.js` — Ollama lifecycle (install/run/version), `chat()` streaming, vision helpers (`isVisionModel`, `hasVisionModel`, `listModels`, `pullModel`, `abortPull`)
- `agent.js` — **native tool-calling loop** (the SOTA path; see Tools below)
- `tools.js` — tool registry (`web_search`, `calculate`, `get_datetime`, `fetch_url`) + `runFetchUrl` (YouTube metadata extraction), DuckDuckGo search, exports `getToolDefinitions/executeTool/ALL_TOOL_NAMES/runFetchUrl`
- `connectors.js` — MCP connector registry, token storage via Electron `safeStorage` (OS keychain)
- `mcp-client.js` — spawns MCP servers over stdio (SDK `@modelcontextprotocol/sdk` 1.29), discovers/calls tools
- `tunnel.js` — Cloudflare named tunnels (runonaspen.com/api/tunnel-provision)
- Others: `apikeys.js`, `gateway.js` (OpenAI-compatible local API), `models.js`, `store.js`, `conversations.js`, `tool-settings.js`, `updater.js`/`hot-updater.js`, `system.js`, `registry.js`, `aliases.js`
- Preload: `src/preload/index.js` (exposes IPC to renderer)

### Vercel (serverless, in `api/` and `site/api/`)
- `api/proxy.js` — main chat proxy for web/mobile → user's tunnel (`/v1/chat/completions`). **Edge runtime.**
- `api/trial.js` — cloud trial (limited free messages)
- `api/search.js`, `api/tunnel-provision.js`, `api/preorder.js`, `api/tts.js`, `api/visits.js`, `api/invite.js`
- **CRITICAL streaming bug pattern (fixed, watch for regressions):** a `ReadableStream` with `async start(controller)` that `await`s makes Vercel **buffer the entire stream** until start() resolves → 504 / no live streaming. FIX: `start()` must be **synchronous**, flush the first byte immediately (`: connected\n\n`), and run the pump in a **detached async IIFE** `(async()=>{...})()`. 8s heartbeats. Applied to proxy.js + trial.js.

---

## TOOLS / AGENT LOOP (current, SOTA)

**Decision (backed by 2026 research):** use **Ollama's native function-calling API**. Gemma 4 and Qwen have native tool-calling (trained with tool tokens). Do NOT use keyword-regex gating or one-word intent classifiers (both were tried and removed).

**Flow (`index.js` → `agent.js`):**
- When tools are enabled, **all** messages route through `agent.runAgent()` (no regex gate). The model decides whether/which tool to call.
- `agent.js` loop: send `tools: toolDefs` → read `msg.tool_calls` → `executeTool` locally → push `role:'tool'` result → loop (max rounds) → final answer.
- **Safety nets (keep these):** model-incompatibility list (deepseek-r1, phi skip tools); plain-text fallback when a small model emits empty/garbled tool calls; round cap; English-only directive.
- **Deterministic URL pre-fetch:** if the user pasted a URL, `runAgent` fetches it directly (don't rely on the model to call `fetch_url`). YouTube URLs return title/channel/description/views/date via og-tags + page JSON (metadata only — cannot "watch" the video; transcript is gated and intentionally not built).
- When tools are **OFF**, `ollama.chat()` streams plainly (keeps only the URL read).

**Known limits:** tool-using responses are **not streamed** (agent returns a final string → a pause). Small gemma4 (e4b) over-calls tools; 12B/27B behave better. Most reliable tool-caller per research: Qwen 3.6-27B.

---

## FEATURES SHIPPED (this era)

- **Artifacts:** code blocks render as artifacts; runnable HTML/SVG opens in a **Claude-style right-side panel** (Preview/Code tabs, Copy, close, resizable divider on web). Content-sniffing detects HTML/SVG when the model omits the language tag. Escaping fixed (extract code from RAW text before escaping prose). Sandboxed iframe (`sandbox="allow-scripts"`, no same-origin). All 3 surfaces.
- **Vision (desktop):** image attach (base64 in Ollama native `images[]`), vision-model detection, one-tap "Get vision model" pull (llava) with progress. Desktop only (native `/api/chat`; `/v1` vision is unreliable).
- **File reading (desktop):** attach PDF / Word (.docx) / Excel (.xlsx) and ask about it. `src/main/file-extract.js` extracts text in MAIN (renderer is sandboxed) via pdf-parse (`PDFParse.getText`), mammoth, xlsx; IPC `files:extractText`; renderer stores result as a text attachment. 100k char cap. Plain text/code/CSV already worked via direct read. All local.
- **Connectors (desktop):** MCP. GitHub connector, encrypted tokens, "+" menu in composer, Connectors page, coding tip. End-to-end GitHub read/write NOT fully tested live.
- **Single-file HTML system prompt:** model told to inline CSS/JS (no external files) so previews render. All 3 surfaces.
- **Auto-scroll:** only sticks to bottom if user is already near bottom; sending forces scroll. Web + mobile.
- **Copy/Retry** action row under assistant messages (web + mobile; not desktop yet).
- **Mobile World Model panel** (sidebar footer, above avatar).
- **Cloud trial counter** fixed (was never decrementing — client didn't re-render + trial.js async-start bug).
- **Thinking indicator:** growing gold-leaf animation.

---

## BUILD / RELEASE

- **Mac release (manual, WORKS):** the only reliable path. Signing cert lives ONLY on the local Mac (not in CI).
  ```
  cd ~/aspen
  npm version patch --no-git-tag-version        # bump FIRST, never overwrite a version
  export APPLE_ID="mayank.mehta@gmail.com"
  export APPLE_APP_SPECIFIC_PASSWORD="<real app-specific pw>"
  export APPLE_TEAM_ID="S6UBG93XBS"
  export GH_TOKEN="<real GitHub PAT, repo scope>"
  npm run release:mac
  ```
  - `release:mac` (`scripts/release-mac.js`): build (`--publish never`) → notarize → **staple → validate** (via `scripts/staple-dmg.js` afterAllArtifactBuild hook) → upload → verify `/releases/latest` serves the new tag. Refuses to ship an unstapled DMG (prevents "Aspen is damaged").
  - Success lines: `notarization successful`, `The staple and validate action worked!`, `Confirmed — users downloading now get vX`.
  - **Mac build = Apple Silicon (arm64) only**, deliberately. Intel Macs are detected on the website (WebGL renderer) and shown "needs Apple Silicon" + browser-app link, instead of a dead "not supported" dialog.
- **GitHub Actions** (`.github/workflows/release.yml`): **auto-trigger DISABLED** (manual `workflow_dispatch` only) because CI can't sign Mac builds. `verify-live-dmg.yml` (daily) is kept — validates the live DMG is stapled.
- **Windows EXE** (`.github/workflows/release-windows.yml`): builds the EXE on a GitHub **windows-latest** runner (Windows builds can't be done on the Mac) and uploads `Aspen-win.exe` + `latest.yml` to the release. Triggers on `v*` tag push OR manual dispatch with a `tag` input. **`release-mac.js` auto-dispatches this** after each Mac release (the push-tag trigger does NOT fire for API-created tags, so the explicit dispatch is required). **EXE is UNSIGNED** — Windows SmartScreen warns "unknown publisher" until a code-signing cert is added (secret `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`). Buying a Windows cert (~$200-400/yr) is the fix.
- **Build commands:** `npm run build:renderer` (vite), `npm run build:mac`, `npm test` (314 tests, 6 files: cloud, landing, main, mcp, renderer, tunnel).
- **Sync:** sandbox/dev pushes to git → user pulls on Mac. Web/site/proxy → Vercel auto-deploy (~1 min). Desktop renderer/main → needs DMG. iOS → `cap sync` + Xcode archive. Mobile cap commands run from `~/aspen/mobile`, NOT repo root.

---

## SEO / AEO (site)

- `site/index.html`: 5 valid JSON-LD blocks (Organization, SoftwareApplication, MobileApplication, FAQPage, HowTo). OG + Twitter cards. Canonical = non-www.
- `site/llms.txt`: AEO file, full capability list. Keep facts consistent across index.html/llms.txt/schema.
- `site/robots.txt`: welcomes AI crawlers (GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot, Google-Extended, Applebot-Extended).
- `site/sitemap.xml`: only indexable pages (home + /privacy); `/app` and `/welcome` are noindex on purpose.
- `vercel.json`: explicit Content-Type for sitemap.xml (application/xml) + robots.txt (text/plain).
- **Style rules:** NO em-dashes anywhere. First-person founder voice ("I built", "I believe"), not preachy second-person.
- **MANDATORY:** after shipping any user-facing feature, update the site (index.html + llms.txt) from a user-value POV.

---

## WORKING NOTES / LESSONS

- **Verify the actually-served file/end state before claiming done.** Many bugs came from fixing 1 of the 3 chat surfaces.
- **Look it up — don't guess.** Verified before coding: Vercel stream buffering, Apple build-swap, npm package existence, MCP SDK API, Ollama vision format, native tool-calling best practice.
- **Don't ship placeholder creds in commands** — write real values when the user asks.
- **Always bump version before release;** never overwrite an existing version.
- The product voice is conviction without preaching: "I think people should have the option," not "why would you trust them."
