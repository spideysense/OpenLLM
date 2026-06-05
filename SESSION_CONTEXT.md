# Aspen — Session Context / Handoff

Everything needed to continue work on Aspen in a fresh context.

> ⚠️ SECURITY: The credentials below have been pasted in chat many times and
> should be ROTATED. They're listed here so work can continue, but rotate the
> GitHub PAT, Apple app-specific password, and any sk-aspen keys ASAP.

---

## What Aspen is
A local-AI desktop app: run LLMs (via Ollama) entirely on your own machine.
Electron + React desktop app, Capacitor iOS companion, and a web/site presence.
Positioned as free desktop software + an optional hardware AI device. Domain:
runonaspen.com. "Nothing leaves your machine" is the core promise.

## Repo
- GitHub: `github.com/spideysense/OpenLLM` (repo name is legacy; product = "Aspen")
- Local Mac clone: `~/aspen`
- Git identity: `Mayank Mehta <mayank.mehta@gmail.com>`

## Credentials (kept OUT of the repo on purpose — secret scanning blocks them)
The real values live in 1Password / your shell env, NOT in git. Placeholders:
```
GitHub PAT:                <GH_TOKEN>            # rotate; store in env/secrets
Apple ID:                  mayank.mehta@gmail.com
Apple app-specific pw:     <APPLE_APP_SPECIFIC_PASSWORD>
Apple Team ID:             S6UBG93XBS
Mac signing identity:      89FD3F540A60DB7AA00C6E53513820E47546E8B8
iOS bundle ID:             com.runonaspen.app
iOS App Store app ID:      6775307566
iOS reviewer API key:      REMOVED from source; revoke server-side
```

## How to cut a release (Mac DMG + auto Windows EXE)
Run from `~/aspen`. The `git checkout package.json` first is REQUIRED — otherwise
`git pull` aborts on the local version bump. Set the version explicitly (don't use
`npm version patch` — local package.json often lags the live release).

```bash
cd ~/aspen
git checkout package.json
git pull
npm version 0.4.15 --no-git-tag-version --allow-same-version   # bump to next unreleased version
export APPLE_ID="mayank.mehta@gmail.com"
export APPLE_APP_SPECIFIC_PASSWORD="<APPLE_APP_SPECIFIC_PASSWORD>"
export APPLE_TEAM_ID="S6UBG93XBS"
export GH_TOKEN="<GH_TOKEN>"
npm run release:mac
```

`release:mac` (scripts/release-mac.js): bumps nothing (you set version) → builds
renderer → **runs smoke gate** → packages DMG → notarizes → staples → uploads to
GitHub release → verifies /releases/latest serves the new tag → **auto-dispatches
the Windows EXE build**. Refuses to ship a broken/unstapled build.

Success looks like: `Confirmed — users downloading now get vX.Y.Z` then
`Windows build started`.

### Other build commands
- `npm run build:mac` — build the DMG locally WITHOUT uploading (open
  `dist/mac-arm64/Aspen.app` to eyeball it).
- `npm run smoke` — build renderer + run the smoke gate standalone.
- `npm run dev` — hot-reload dev mode.
- Mac build is **arm64 only** (deliberate). Windows EXE is **unsigned** (SmartScreen
  warns; needs a Windows code-signing cert ~$200-400/yr, secret WIN_CSC_LINK).

## CURRENT STATE (as of this handoff)
- package.json version locally: **0.4.6** (lags; always set version explicitly)
- Latest RELEASED tag: **v0.4.14** (live)
- Latest commit on main: `4748083` (web_search improvements — NOT yet released)
- **NEXT ACTION: cut v0.4.15** to ship the web_search fixes below.

## The smoke gate (scripts/smoke-test.js)
Launches the REAL built Electron app with the real preload + all startup IPC
mocked, and FAILS the release if: main process throws, renderer fails to load,
console has errors, or #root renders < 2000 chars (blank screen). This is what
catches the runtime bugs that `npm test`/`vite build` miss. Wired into release:mac
before packaging. It can ONLY run where Electron exists (your Mac / CI), not in a
Linux sandbox.

## Architecture quick map
- **Three chat UIs (structural debt — every chat feature built 3×):**
  - Desktop: `src/renderer/pages/Chat.jsx` (React)
  - Mobile: `mobile/www/index.html`
  - Web: `site/app/index.html`
- **Desktop main process** (`src/main/`): index.js (IPC + chat routing),
  ollama.js (LLM lifecycle/streaming), agent.js (native tool-calling loop),
  tools.js (web_search/calculate/fetch_url/get_datetime), connectors.js +
  mcp-client.js (MCP), tunnel.js, gateway.js, apikeys.js, file-extract.js,
  hot-updater.js. Preload: `src/preload/index.js`.
- **Vercel** (`api/`): proxy.js (chat proxy w/ SearXNG+Brave search), search.js,
  trial.js, tts.js, tunnel-provision.js, preorder.js. Auto-deploys ~1 min.
- Tests: `npm test` (vitest) — 314 pass, 20 skip.
- Build renderer: `npx vite build` → outputs to `build/`.

## Sync model
Sandbox/Claude pushes to git → you `git pull` on Mac. Web/site/api → Vercel
auto-deploys. Desktop renderer/main changes → need a new DMG. **GOTCHA: Mac
`git pull` aborts if package.json has local changes → always
`git checkout package.json` FIRST.**

## What shipped recently (the saga)
- **v0.4.13**: fixed a blank-screen crash. Root cause was a minifier temporal-
  dead-zone: bare top-level consts (convo/messages/convoHasCode/RUNNABLE) got
  merged into one comma-expression → "Cannot access 'an' before initialization".
  Fix: wrap them in `useMemo` so the minifier can't collapse them. Plus an MCP
  require-path crash (use canonical `@modelcontextprotocol/sdk/client` subpath +
  lazy/guarded load so a connector issue can never crash launch).
- **v0.4.14**: fixed intermittent EMPTY assistant bubbles (stream 'done' handler
  read finalContent in a setTimeout before the state updater ran — now captured
  inside one functional updater). Fixed TTS 404 (CDN path index.js →
  piper-tts-web.js; TTS is optional, fails silently). Fixed web_search returning
  0 results (DDG HTML parser regex was stale — now splits per result block and
  extracts title/link/snippet independently; verified 6 real results live).
- **v0.4.15 (committed, NOT released)**: web_search now reads the actual result
  PAGES on the user's machine (top 3, ~3500 chars each) and includes DDG instant-
  answer JSON, so the model answers current/factual questions with real data
  instead of "check these links". Verified the fetched pages contain the answers
  (Yahoo Finance GOOG = 18KB text, Wikipedia = 62KB). All local, no API key,
  unlimited (runs from user's residential IP). Hardened the agent directive to
  force web_search on anything current/factual.

## Key technical lessons (don't relearn the hard way)
1. Runtime errors in the PACKAGED Electron app are invisible to `npm test` /
   `vite build` / `node --check`. You MUST launch the built app (or run the smoke
   gate) to catch them.
2. To debug a minified renderer crash, READ THE ACTUAL BUNDLE
   (`build/assets/index-*.js`) and map the minified var back to source — don't guess.
3. The Claude sandbox's network is blocked for many hosts (DDG, SearXNG, etc.
   return 403 from datacenter IPs). This does NOT reflect the user's machine,
   which runs on a residential IP where these work fine. Verify behavior via the
   app's DevTools console, not the sandbox.
4. Main-process (Node) fetches have NO CORS limits; renderer fetches do. A CORS
   failure in a console test doesn't mean the tool fails.
5. Always set the release version explicitly and `git checkout package.json`
   before pulling.

## Known limitations / future work
- Weather.com-style JS SPAs: the value is JS-rendered, not in fetched HTML. Other
  results (NWS, localconditions) usually carry the number. If weather needs to be
  rock-solid, add `wttr.in/<zip>?format=j1` (free, no key, plain JSON) as a
  weather-specific source in tools.js runSearch — ~5 min.
- Windows EXE is unsigned (SmartScreen warning).
- DDG instant-answer JSON returns empty for most modern queries (kept as a cheap
  bonus for dictionary terms only).

## Outstanding TODO (user — Claude can't do these)
1. **Rotate** the GitHub PAT + Apple app-specific password (pasted many times).
2. ~~**Revoke** the iOS reviewer key~~ **DONE** — removed from source. Revoke server-side too.
3. Verify App Store link loads: https://apps.apple.com/app/id6775307566
4. Fix sitemap www/non-www in Vercel domain settings for runonaspen.com.
5. (Optional) Windows code-signing cert to kill the SmartScreen warning.
6. **Cut v0.4.15** to ship the web_search improvements (commit 4748083).

## Website sync rule
After shipping any user-facing Aspen feature, also update runonaspen.com
(site/index.html + llms.txt) from a user-value POV. No em-dashes; first-person
founder voice. Keep facts consistent across index.html / llms.txt / schema.

## Fuller architecture doc
See `ASPEN_HANDOFF.md` in the repo root for the deeper architecture writeup
(streaming, vision, connectors, artifacts, file-reading, SEO/AEO, build process).
