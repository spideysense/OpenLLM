# OpenLLM — Development Guide

## Commands

```bash
npm install          # install dependencies
npm run dev          # run in dev mode (Electron + Vite hot reload)
npm run build:mac    # build Mac .dmg
npm run build:win    # build Windows .exe
npm test             # run test suite (Vitest)
npm run test:watch   # watch mode tests
```

**Prerequisites:** Node.js 20+, Ollama installed locally.

---

## Project Structure

```
OpenLLM/
├── src/
│   ├── main/          # Electron main process (Node.js, full system access)
│   │   ├── index.js   # Entry point, window management, IPC handlers
│   │   ├── ollama.js  # Ollama lifecycle (install, start, stop, chat)
│   │   ├── models.js  # Model management (list, pull, delete, recommend)
│   │   ├── system.js  # Hardware detection (GPU, RAM, tier classification)
│   │   ├── gateway.js # API gateway on :4000 (auth, aliasing, proxy)
│   │   ├── apikeys.js # API key generation + validation
│   │   ├── aliases.js # Model alias resolution (gpt-4 → local model)
│   │   ├── registry.js# Fetch + compare curated model registry
│   │   └── store.js   # Persistent local JSON storage
│   ├── preload/
│   │   └── index.js   # IPC bridge (contextBridge) — runs in isolated context
│   └── renderer/      # React UI (browser context, no Node.js)
│       ├── App.jsx    # Router, state management, layout
│       ├── styles.css # LLM Bear global theme
│       ├── components/
│       └── pages/
├── registry/
│   └── models.json    # Curated model registry + alias defaults
├── cloud/             # Cloud proxy + billing backend (Vercel)
├── mcp/               # MCP server for AI tool access
├── site/              # Landing page (llmbear.com)
├── tests/             # Test suite (Vitest)
├── PLAN.md            # Full project plan
└── DESIGN.md          # LLM Bear design spec
```

---

## IPC Architecture (IMPORTANT)

Electron has three contexts — they cannot call each other directly:

| Context | File(s) | Access |
|---|---|---|
| Main process | `src/main/` | Full Node.js + OS |
| Preload | `src/preload/index.js` | Bridge only |
| Renderer | `src/renderer/` | Browser APIs only |

**Rule:** Every capability from the main process must be explicitly exposed through `contextBridge` in preload. Renderer calls `window.api.doThing()`. If it's not in preload, renderer can't use it.

---

## Commit Style

**Always bisect commits.** Every commit = one logical change. When you've made multiple changes, split them before pushing. Each commit should be independently understandable and revertable.

Good bisection examples:
- IPC handler additions separate from UI changes
- New model registry entries separate from model logic refactors
- UI component additions separate from page wiring

---

## Testing

```bash
npm test             # run before every commit
```

Tests live in `tests/`. Structure mirrors `src/`:
- `tests/main/`     — main process unit tests
- `tests/renderer/` — React component tests
- `tests/cloud/`    — cloud backend tests
- `tests/mcp/`      — MCP server tests

---

## Before Every Push: Review Checklist

Run yourself through `.gstack/skills/review-checklist.md` before pushing. Specifically:
1. Is the IPC bridge complete for every new capability? (No renderer reaching for Node APIs directly)
2. Are Ollama lifecycle calls guarded against errors? (Model not found, Ollama not running, download interrupted)
3. Does hardware detection have a fallback for unknown GPU/RAM configs?
4. Are API keys validated before any gateway call?
5. Does the new code survive Mayank challenging it?

---

## CHANGELOG Style

After every user-facing feature or fix, add an entry to `CHANGELOG.md`:
- Feature name in plain English
- User benefit (what they can now do)
- Date in YYYY-MM-DD format

Written for users, not contributors. "You can now..." not "Refactored the..."

---

## Design Constraints

- **Bear mascot is the guide** — every confusing moment is the bear speaking, not a raw error
- **Zero jargon** — "Get this model" not "Pull the 7B GGUF"
- **No dark mode by default** — sunshine and bears, not hacker terminals
- **Playful but not childish** — Baloo 2 / Nunito fonts, warm palette
- See `DESIGN.md` for full spec

---

## gstack Ethos

Read `ETHOS.md`. The three principles that apply every day on this project:

1. **Boil the Lake** — completeness is cheap with AI. Do the complete thing.
2. **Search Before Building** — check what exists before designing a solution.
3. **User Sovereignty** — AI recommends. User decides. Never act on a user's behalf without an explicit ask.
