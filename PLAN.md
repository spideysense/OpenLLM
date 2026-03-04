# LLM Bear — Project Plan

**Mission:** Give anyone a one-click way to run the best open source LLMs locally. No API keys, no subscriptions, no terminal. Replace the need to pay $20/mo for ChatGPT/Claude.

**Audience:** Regular people and citizen developers who are tired of paying for AI. Non-technical. They don't know what a "parameter" is and they shouldn't need to.

**Design:** Playful coding bear mascot with glasses, warm approachable aesthetic. See [DESIGN.md](DESIGN.md) for full design spec.

---

## 1. Core Concept

A desktop app (Mac + Windows) that:
1. Installs Ollama silently under the hood (user never sees a terminal)
2. Recommends the best model for their hardware automatically
3. Gives them a ChatGPT-like chat interface immediately
4. Auto-detects when a better model is available and prompts them to upgrade
5. Exposes a local API so citizen devs can build apps on top

The user experience is install, open, done. Friendly coding bear mascot, warm colors. Not a hacker tool. See [DESIGN.md](DESIGN.md).

---

## 2. Architecture

```
┌──────────────────────────────────────────────┐
│              LLM Bear (Electron)               │
│                                               │
│  ┌────────────┐  ┌─────────────────────────┐ │
│  │  Renderer   │  │     Main Process        │ │
│  │  (React)    │◄─┤  - Ollama lifecycle     │ │
│  │             │  │  - Model management     │ │
│  │  Pages:     │  │  - Update checker       │ │
│  │  - Chat     │  │  - System profiler      │ │
│  │  - Models   │  │  - Auto-updater         │ │
│  │  - Settings │  │  - IPC bridge           │ │
│  └────────────┘  └───────────┬─────────────┘ │
│                               │               │
└───────────────────────────────┼───────────────┘
                                │
          ┌─────────────────────▼──────────────────┐
          │           Ollama (embedded)              │
          │         localhost:11434                   │
          │  - Runs models via llama.cpp / MLX       │
          │  - OpenAI-compatible API                 │
          │  - Handles GPU/CPU inference             │
          └─────────────────────┬──────────────────┘
                                │
          ┌─────────────────────▼──────────────────┐
          │         User's Apps / Integrations       │
          │  LangChain, Cursor, n8n, custom apps    │
          │  (point at localhost:11434/v1)           │
          └────────────────────────────────────────┘
```

**Key decision: Electron, not a web app.** The audience doesn't want to run a server and open a browser tab. They want to double-click an app icon.

---

## 3. User Journey (First Run)

Inspired by "install → open → done" simplicity:

```
Download .dmg / .exe  →  Install (one click)  →  App opens
       │
       ▼
  ┌─────────────────────────────────────────┐
  │  🐻 "Hi! I'm LLM Bear."               │
  │                                         │
  │  "I run AI on your computer.            │
  │   No subscriptions. No data sharing."   │
  │                                         │
  │  Detected: MacBook Pro M2, 16GB RAM     │
  │                                         │
  │  ★ I recommend: Qwen 2.5 7B            │
  │  "Smart, fast, great for everyday use"  │
  │                                         │
  │  [ Download & Start → ]                 │
  └─────────────────────────────────────────┘
       │
       ▼
  Bear pushes progress bar (animated)
  "Getting your model ready... almost there!"
       │
       ▼
  🐻 pops out of a yellow pipe, celebrating!
  "Rawr! Your AI is running!"
  Map view opens — bear is at the "General" model island.
  Toggle is ON. API is serving.
  User is chatting within minutes.
```

**No decisions required on first run.** We pick the best model for them. Power users can browse the model hub later. Install, open, you have AI.

---

## 4. Feature Breakdown

### P0 — MVP (Ship This)

| Feature | Description |
|---------|-------------|
| **Silent Ollama Setup** | Bundle or auto-download Ollama. User never sees a terminal. Detect if already installed. |
| **Hardware Profiler** | Detect GPU (Metal/CUDA/CPU-only), RAM, architecture. Use this to filter which models are shown and which is recommended. |
| **Smart Model Recommendation** | On first run, auto-select the best model for their hardware. No jargon — just "Fast & Light" vs "Powerful" vs "Best Available". |
| **Chat Interface** | Full-screen, ChatGPT-style chat. Markdown rendering, code blocks with copy button, conversation history (stored locally in SQLite or JSON). |
| **Model Hub** | Curated list of best-in-class models, organized by use case (not by parameter count). Categories: "General", "Coding", "Reasoning", "Creative Writing". Each card shows plain-English description, download size, and whether it'll run well on their machine. |
| **One-Click Download** | Download models with a progress bar and estimated time. Handle resume on failure. |
| **Upgrade Detector** | Background check (daily or on app open): compare installed model digests against Ollama registry. If a newer/better model is available in the same category, show a non-intrusive banner: "A faster model is available! Switch with one click." |
| **Local API Gateway** | A thin proxy (runs in the Electron main process on port 4000) that sits in front of Ollama and adds: **(a)** API key generation/validation — user generates `sk-llmbear-...` keys in the app, gateway checks them on every request, **(b)** Model aliasing — user can call `model: "gpt-4"` or `model: "claude-3"` and it routes to their local model, **(c)** Full OpenAI `/v1/chat/completions`, `/v1/models`, `/v1/embeddings` compatibility. This means existing code that uses `openai.ChatCompletion.create()` works by changing only `base_url` and `api_key`. |
| **"Replace OpenAI" Wizard** | In-app page that walks users through: pick which service you're replacing (OpenAI / Anthropic / etc.) → select which local model maps to which role → generates API key → shows exact copy-paste code with their key and base URL pre-filled. Zero guesswork. |
| **Cross-Platform Builds** | Mac (.dmg, universal binary for Intel + Apple Silicon) and Windows (.exe NSIS installer). GitHub Actions CI/CD. |

### P1 — Fast Follow

| Feature | Description |
|---------|-------------|
| **Conversation History** | Sidebar with past chats, searchable, deletable. Stored 100% locally. |
| **Multiple Model Slots** | Let users have 2-3 models installed and switch between them in chat ("Use Reasoning Model" vs "Use Coding Model"). |
| **System Tray / Menu Bar** | Minimize to tray. Quick-launch chat from anywhere. Show status (model loaded, API ready). |
| **"New Model Alert" Feed** | Periodically fetch a curated JSON from our repo (or a simple API) that lists the current best-in-class models per category. When there's a new leader, notify the user. This is separate from Ollama's own model updates — this is about *new models entirely* (e.g., "Qwen 3 just dropped and it's better than what you have"). |
| **Guided API Setup** | Walk citizen devs through connecting their first app. "Want to use this in your Python project? Here's how." Interactive, not just docs. |
| **Usage Stats** | Simple dashboard: tokens generated, conversations, uptime. Fun, not nerdy. |

### P2 — Later

| Feature | Description |
|---------|-------------|
| **RAG / Document Chat** | Drag-and-drop PDFs/docs, chat with them using local embeddings. |
| **Image Generation** | When Ollama supports Stable Diffusion or similar, surface it. |
| **Plugin System** | Let citizen devs build simple tools/plugins (e.g., "summarize my clipboard"). |
| **Model Comparison** | Side-by-side view: ask the same question to two models, see which answers better. |

---

## 5. Model Curation Strategy

We don't just list every Ollama model. We maintain a **curated registry** — a JSON file in this repo — that tracks the current best-in-class model per category and hardware tier.

```json
{
  "version": "2025-03-03",
  "categories": {
    "general": {
      "small": { "model": "qwen2.5:7b",  "name": "Qwen 2.5 7B",  "min_ram_gb": 8,  "needs_gpu": false },
      "medium": { "model": "qwen2.5:32b", "name": "Qwen 2.5 32B", "min_ram_gb": 24, "needs_gpu": true },
      "large": { "model": "llama3.3",     "name": "Llama 3.3 70B", "min_ram_gb": 48, "needs_gpu": true }
    },
    "coding": {
      "small": { "model": "qwen2.5-coder:7b", "name": "Qwen 2.5 Coder 7B", "min_ram_gb": 8 },
      "medium": { "model": "phi4",             "name": "Phi-4 14B",          "min_ram_gb": 16 }
    },
    "reasoning": {
      "small": { "model": "deepseek-r1:8b",  "name": "DeepSeek R1 8B",  "min_ram_gb": 8 },
      "medium": { "model": "deepseek-r1:32b", "name": "DeepSeek R1 32B", "min_ram_gb": 24 }
    }
  }
}
```

**This is the key differentiator.** Ollama has 100+ models. Regular users don't want to research which one is good. We do that for them and push updates via this registry.

**Upgrade flow:**
1. App checks this JSON on open (fetched from GitHub raw or a simple CDN)
2. Compares against what's installed
3. If there's a newer `version` and the recommended model changed → show upgrade banner
4. User clicks "Upgrade" → old model is swapped for new one

---

## 6. Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| **App Shell** | Electron 28+ | Cross-platform, proven, good for wrapping native processes |
| **UI Framework** | React + Tailwind | Fast to build, component-friendly, easy to maintain |
| **Build/Bundle** | Vite | Fast dev server, clean builds |
| **Installer** | electron-builder | Handles .dmg, .exe, code signing, auto-update |
| **LLM Runtime** | Ollama (embedded/managed) | Industry standard. Handles llama.cpp, Metal, CUDA, quantization. We don't reinvent this. |
| **Chat Storage** | Local SQLite (via better-sqlite3) | Conversations stay on-device. Fast, no server. |
| **Model Registry** | JSON in this repo | Simple, versionable, no backend needed |
| **CI/CD** | GitHub Actions | Build on push/tag, produce Mac + Windows artifacts |
| **Auto-Update** | electron-updater | Push app updates via GitHub Releases |

---

## 7. Project Structure

```
LLMBear/
├── .github/
│   └── workflows/
│       └── build.yml              # CI: build Mac + Win installers
├── assets/
│   ├── icon.icns                  # Mac icon
│   ├── icon.ico                   # Windows icon
│   └── icon.svg                   # Source icon
├── registry/
│   └── models.json                # Curated model registry (the upgrade source)
├── src/
│   ├── main/
│   │   ├── index.ts               # Electron main process
│   │   ├── ollama.ts              # Ollama lifecycle (install, start, stop, health)
│   │   ├── models.ts              # Model management (pull, delete, list, update check)
│   │   ├── system.ts              # Hardware detection (GPU, RAM, platform)
│   │   ├── registry.ts            # Fetch + compare curated model registry
│   │   ├── gateway.ts             # API gateway server (port 4000) — auth, aliasing, proxy
│   │   ├── apikeys.ts             # API key generation, validation, storage
│   │   ├── aliases.ts             # Model alias resolution (gpt-4 → local model)
│   │   └── store.ts               # Local settings (electron-store)
│   ├── preload/
│   │   └── index.ts               # IPC bridge
│   ├── renderer/
│   │   ├── index.html             # Entry HTML
│   │   ├── App.tsx                # Root React component
│   │   ├── pages/
│   │   │   ├── Onboarding.tsx     # First-run setup wizard
│   │   │   ├── Chat.tsx           # Main chat interface
│   │   │   ├── ModelHub.tsx       # Browse + download models
│   │   │   ├── ReplaceWizard.tsx  # "Replace OpenAI" step-by-step wizard
│   │   │   ├── APIKeys.tsx        # Generate, manage, revoke API keys
│   │   │   └── Settings.tsx       # Preferences, model aliases, about
│   │   ├── components/
│   │   │   ├── Sidebar.tsx        # Nav + conversation list
│   │   │   ├── ChatMessage.tsx    # Message bubble w/ markdown
│   │   │   ├── ModelCard.tsx      # Model in the hub
│   │   │   ├── ProgressBar.tsx    # Download progress
│   │   │   ├── UpgradeBanner.tsx  # "New model available" prompt
│   │   │   ├── CodeBlock.tsx      # Syntax-highlighted code
│   │   │   ├── APIKeyCard.tsx     # Single API key display + actions
│   │   │   └── AliasEditor.tsx    # "gpt-4 → [model dropdown]" row
│   │   ├── hooks/
│   │   │   ├── useOllama.ts       # React hook for Ollama state
│   │   │   ├── useChat.ts         # Chat logic + streaming
│   │   │   └── useRegistry.ts     # Model registry + upgrade detection
│   │   └── styles/
│   │       └── globals.css        # Tailwind + custom styles
│   └── shared/
│       └── types.ts               # Shared TypeScript types
├── package.json
├── tsconfig.json
├── vite.config.ts
├── electron-builder.yml
├── tailwind.config.js
├── PLAN.md                        # This file
└── README.md
```

---

## 8. Upgrade Detection — How It Works

This is the "always have the latest and greatest" feature. Two layers:

### Layer 1: Model Version Updates (Ollama-level)
- On app open, for each installed model, call `ollama pull <model> --dry-run` (or compare digests via API)
- If a newer version of the *same* model exists → show "Update available" badge
- User clicks → re-pull happens in background

### Layer 2: New Best-in-Class Models (Registry-level)
- We maintain `registry/models.json` in this repo
- App fetches it periodically (daily or on open)
- If the recommended model for the user's hardware tier + use case has *changed* (e.g., Qwen 3 replaced Qwen 2.5 as the best small general model), show a banner:
  > "🚀 There's a new best-in-class model: Qwen 3 7B. It's faster and smarter than your current model. Switch now?"
- One click: downloads new model, optionally removes old one
- **This is the killer feature.** Users never fall behind.

### Registry Update Process
- Maintainers (us) update `models.json` when a significant new model drops
- We can also add a `"changelog"` field per entry so users see *why* we recommend the switch
- No backend needed — it's just a raw JSON file on GitHub

---

## 9. API Gateway — "Just Change Two Lines"

This is what makes LLM Bear a true replacement, not just a toy. The goal: any app, script, or tool that calls OpenAI or Anthropic should work by changing **only** the base URL and API key. Nothing else.

### Architecture

```
Your App / Script / Tool
    │
    │  base_url = "http://localhost:4000/v1"
    │  api_key  = "sk-llmbear-abc123..."
    │
    ▼
┌─────────────────────────────────────┐
│     LLM Bear API Gateway (:4000)     │
│                                     │
│  1. Validate API key                │
│  2. Resolve model alias             │
│     "gpt-4" → "qwen2.5:32b"        │
│     "claude-3" → "llama3.3"         │
│  3. Proxy to Ollama                 │
│                                     │
└───────────────┬─────────────────────┘
                │
                ▼
        Ollama (:11434)
```

The gateway runs as a lightweight HTTP server inside the Electron main process. No Docker, no extra installs. It starts automatically with the app.

### API Key Management

- User clicks "Generate API Key" in the app → gets `sk-llmbear-xxxxxxxxxxxx`
- Keys are stored locally (encrypted in electron-store)
- User can create multiple keys (one per project/app), revoke them, see last-used timestamp
- Gateway validates `Authorization: Bearer sk-llmbear-...` on every request
- If no keys are configured yet, gateway runs in "open mode" (accepts anything) for easy first-time setup
- Keys are local-only. They never leave the machine. They exist so users have something to paste into the `api_key` field that their tools require.

### Model Aliasing

This is critical. Users shouldn't have to remember `qwen2.5:32b`. They should be able to use the names they already know.

**Default alias map** (configurable in Settings):

```json
{
  "gpt-4":           "→ best installed 'heavy' general model",
  "gpt-4o":          "→ best installed 'medium' general model",
  "gpt-3.5-turbo":   "→ best installed 'light' general model",
  "claude-3-opus":    "→ best installed 'heavy' general model",
  "claude-3-sonnet":  "→ best installed 'medium' general model",
  "claude-3-haiku":   "→ best installed 'light' general model",
  "o1":              "→ best installed reasoning model",
  "codex":           "→ best installed coding model"
}
```

How it works:
1. User's code says `model: "gpt-4"`
2. Gateway looks up alias → finds `qwen2.5:32b` (or whatever they have installed)
3. Forwards to Ollama with the real model name
4. Returns response in exact OpenAI format

Users can also override aliases in Settings: "When something asks for `gpt-4`, use: [dropdown of installed models]"

### Supported Endpoints

| Endpoint | Status | Notes |
|----------|--------|-------|
| `POST /v1/chat/completions` | ✅ Full | Streaming + non-streaming. Tool/function calling. |
| `GET /v1/models` | ✅ Full | Returns installed models + all active aliases |
| `POST /v1/completions` | ✅ Full | Legacy completions API |
| `POST /v1/embeddings` | ✅ Full | If an embedding model is installed |
| `POST /v1/images/generations` | 🔜 P1 | When Ollama image gen matures |

### The "Replace OpenAI" Wizard

This is a guided in-app page that holds the user's hand:

```
Step 1: What are you replacing?
  ○ OpenAI (ChatGPT / API)
  ○ Anthropic (Claude)
  ○ Google (Gemini)
  ○ Other OpenAI-compatible service

Step 2: Pick your local models
  When apps ask for "gpt-4", use: [ Qwen 2.5 32B     ▾ ]
  When apps ask for "gpt-3.5", use: [ Qwen 2.5 7B      ▾ ]
  (pre-filled with smart defaults based on what's installed)

Step 3: Your API credentials
  ┌──────────────────────────────────────────────┐
  │  Base URL:  http://localhost:4000/v1    [Copy]│
  │  API Key:   sk-llmbear-a8f2k...        [Copy]│
  └──────────────────────────────────────────────┘

Step 4: Try it — paste this into your code:

  Python, JavaScript, cURL, and Cursor/Continue.dev snippets
  — all pre-filled with the user's actual key and base URL.
  Copy-paste and go.
```

### Why Port 4000 (Not 11434)

- Port 11434 is Ollama's raw endpoint — no auth, Ollama model names only
- Port 4000 is our gateway — auth, aliasing, OpenAI-format model names
- We tell users about 4000. Power users who want raw Ollama can use 11434 directly.
- If port 4000 is taken, app auto-selects next available and shows it in the UI.

## 10. Milestones

### M1: Skeleton (Week 1)
- [ ] Electron + Vite + React + Tailwind project scaffolded
- [ ] Main process: Ollama detection, install prompt, start/stop
- [ ] Hardware profiler (GPU, RAM, platform detection)
- [ ] Basic IPC bridge working
- [ ] Can pull a model and stream a chat response

### M2: Chat & Onboarding (Week 2)
- [ ] First-run onboarding wizard (hardware detect → model recommend → download → chat)
- [ ] Chat interface with streaming, markdown, code blocks
- [ ] Conversation stored locally
- [ ] Sidebar with conversation list

### M3: API Gateway & Model Hub (Week 3)
- [ ] API gateway running on port 4000 with key validation
- [ ] API key generation, storage, revocation UI
- [ ] Model aliasing engine (gpt-4 → local model mapping)
- [ ] "Replace OpenAI" wizard with pre-filled code snippets
- [ ] Model hub page with curated cards
- [ ] Category/use-case filtering (not jargon-heavy)
- [ ] Download progress with resume support

### M4: Upgrades, Polish & Ship (Week 4)
- [ ] Registry fetch + upgrade detection (new best-in-class alerts)
- [ ] Upgrade banner component
- [ ] Electron-builder config for Mac .dmg + Windows .exe
- [ ] GitHub Actions CI/CD pipeline
- [ ] Auto-updater for the app itself
- [ ] System tray / menu bar integration
- [ ] Landing page / README
- [ ] First release: v0.1.0

---

## 11. What We're NOT Building

- **A new inference engine.** Ollama handles this. We're a UI + curation layer.
- **A cloud service.** Everything runs locally. No accounts, no telemetry, no data collection.
- **Support for every model.** We curate. Quality over quantity.
- **A mobile app.** Desktop first. Mobile is a different problem.
- **Fine-tuning tools.** Out of scope for MVP. Maybe P2.

---

## 12. Open Questions

1. **Bundle Ollama or require separate install?** Bundling makes UX simpler but increases app size (~100MB) and we need to handle updates. Separate install means one extra step but we always get the latest Ollama. **Recommendation: Auto-download Ollama on first run, don't bundle.**

2. **App name: "LLM Bear".** The coding bear mascot is central to the UX. The name is friendly, memorable. See [DESIGN.md](DESIGN.md).

3. **How opinionated should the default be?** Very. The app should work with zero decisions on first run. Pick the best model for their hardware and go. Expert mode is there but hidden.

4. **How often to check the registry?** On app open + once every 24 hours. Don't be annoying — if user dismisses an upgrade, don't ask again for that same model version.

---

## 13. Competitive Landscape

| Tool | What It Does | Gap We Fill |
|------|-------------|-------------|
| **Ollama (CLI)** | Best runtime, but terminal-only | We add the GUI + curation + auto-upgrade + API gateway with keys & aliasing |
| **Open WebUI** | Web-based chat UI for Ollama | Requires running a separate server, Docker, config. No API key management. Not for normies. |
| **LM Studio** | GUI for local models | Closed source, own inference engine, no auto-upgrade, no model aliasing, can't "replace OpenAI" |
| **GPT4All** | Desktop app for local LLMs | Outdated model selection, no auto-upgrade, no API gateway, clunky |
| **Jan** | Desktop app, open source | Still technical, doesn't curate, no alias mapping, no "replace OpenAI" wizard |

**Our edge: The only app where you can generate an API key, alias `gpt-4` to a local model, and have existing code work by changing two lines.** Plus: opinionated curation, auto-upgrade, dead-simple UX.

---

## Next Step

Once this plan is approved, I'll start with **M1: Skeleton** — scaffolding the Electron + React project, getting Ollama lifecycle management working, and proving we can go from app launch → model download → streaming chat in a single flow.
