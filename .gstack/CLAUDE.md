# Aspen — Developer Guide for AI Assistants

Read ASPEN_HANDOFF.md first. This file covers the tactical workflow.

---

## MANDATORY PRE-WORK (do before touching any code)

1. Read `ASPEN_HANDOFF.md` — architecture, known bugs, critical patterns
2. Read `tests/critical/` — understand what must never regress
3. Run `npx vitest run tests/critical/` — baseline must be green before you start

---

## COMMANDS

```bash
npm install                           # install deps
npm run dev                           # Electron + Vite hot reload
npm run build:renderer                # build renderer only
npx vitest run tests/critical/        # critical regression suite
npx vitest run                        # all tests
npm run release:mac -- 0.4.XX        # cut a Mac release (pass version as arg)
```

---

## RELEASE PROCESS (do it right)

```bash
cd ~/aspen
git pull && npm install
export APPLE_ID="mayank.mehta@gmail.com"
export APPLE_APP_SPECIFIC_PASSWORD="<app-specific-pw>"
export APPLE_TEAM_ID="S6UBG93XBS"
export GH_TOKEN="<GitHub PAT>"
npm run release:mac -- 0.4.XX
```

**Rules:**
- Pass version as CLI arg to `release:mac` — do NOT run `npm version` manually first
- Never create a GitHub release manually for a version the Windows workflow will also create
- After a release, delete any rogue releases (wrong version) immediately — they break auto-updates
- The script staples BEFORE upload. If stapling fails, do not upload.

---

## BEFORE EVERY PUSH

1. `npx vitest run tests/critical/` — all 108 must pass
2. If you changed gateway.js CORS: verify www.runonaspen.com AND runonaspen.com are both allowed
3. If you added a new persistent setting: add its key to STORE_ALLOWLIST in src/main/index.js
4. If you changed a chat feature: verify it works in ALL THREE surfaces (desktop React, site/app/index.html, mobile/www/index.html)
5. If you changed api/*.js: verify no double JSON.stringify in Upstash calls
6. Write a test for any bug you fixed — add it to tests/critical/regressions.test.js

---

## ARCHITECTURE RULES

### IPC (Electron)
Three isolated contexts. Renderer cannot call Node APIs directly.
- Main process (`src/main/`) — full Node.js
- Preload (`src/preload/index.js`) — exposes IPC via contextBridge
- Renderer (`src/renderer/`) — browser only

Every new capability: add IPC handler in `src/main/index.js` + expose in `src/preload/index.js`.

### Gateway vs Desktop agent
- Desktop agent (`agent.js`) — uses Electron APIs (desktopCapturer, electron-store). Only runs in desktop app.
- Gateway agent (`gateway-agent.js`) — zero Electron deps. Uses CLI screencapture. Powers web+mobile tool use via `/v1/agent`.
- NEVER import electron in gateway-agent.js or any file the gateway uses.

### Tool definition formats
- Regular tools: OpenAI format `{type:'function', function:{name, description, parameters}}`
- Computer tools in `computer-use.js`: Anthropic format `{name, input_schema}` — desktop only
- Computer tools in `gateway-agent.js`: OpenAI format — required for Ollama
- Do not mix these formats.

### Vercel streaming
ReadableStream `start()` must be SYNCHRONOUS. Flush `': connected\n\n'` immediately. Real work goes in a detached `(async()=>{})()`. 8s heartbeat comments. See `api/agent.js` for the reference implementation.

---

## THINGS THAT LOOK SAFE BUT AREN'T

- `bridge.store.set(key, val)` — silently fails if key not in STORE_ALLOWLIST
- `git checkout -- package.json` in release script discards local version bump (fixed — script now uses CLI arg)
- Upstash `body: JSON.stringify(value)` when value is already a JSON string — double-encodes
- `sendBtn.addEventListener('click', sendMessage)` — passes MouseEvent as `autoRespond`, breaks input
- `desktopCapturer` — only available in Electron main process, not gateway
- `skills.js` and `tool-settings.js` — require Electron, don't use in gateway-agent
- CORS only allowing `https://runonaspen.com` without www — breaks web+mobile entirely

---

## COMMIT STYLE

One logical change per commit. Good commit message: `Fix: <what broke> (<why>)` or `feat: <what it does>`.

After any user-facing change, also update:
- `ASPEN_HANDOFF.md` — if architecture or patterns changed
- `site/index.html` + `site/llms.txt` — from user-value POV
- `CHANGELOG.md` (if it exists) — feature name, user benefit, date

---

## ETHOS

Read `ETHOS.md`. The critical ones for this project:
1. **Boil the lake** — write the test, fix all three surfaces, handle the edge case. Shortcuts become production bugs.
2. **Look it up** — never guess at API formats, verify with actual docs. Half the bugs in this codebase came from guessing.
3. **Check the whole stack** — a fix in the Electron app doesn't fix the web app. A fix in the Vercel proxy doesn't fix the gateway. Think about all three surfaces and both compute locations (Vercel + local machine).
