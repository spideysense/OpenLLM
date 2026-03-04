# OpenLLM — Project Plan

**Mission:** Give anyone a one-click way to run the best open source LLMs locally. No API keys, no subscriptions, no terminal. Replace the need to pay $20/mo for ChatGPT/Claude.

**Audience:** Regular people and citizen developers who are tired of paying for AI. Non-technical. They don't know what a "parameter" is and they shouldn't need to.

---

## 1. Core Concept

A desktop app (Mac + Windows) that:
1. Installs Ollama silently under the hood (user never sees a terminal)
2. Recommends the best model for their hardware automatically
3. Gives them a ChatGPT-like chat interface immediately
4. Auto-detects when a better model is available and prompts them to upgrade
5. Exposes a local API so citizen devs can build apps on top

The user experience should feel like installing Spotify — not like configuring a server.

---

## 2. Architecture

```
┌──────────────────────────────────────────────┐
│              OpenLLM (Electron)               │
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

```
Download .dmg / .exe  →  Install (one click)  →  App opens
       │
       ▼
  ┌─────────────────────────────────────────┐
  │  "Welcome to OpenLLM"                   │
  │                                         │
  │  We'll set everything up for you.       │
  │  Detected: MacBook Pro M2, 16GB RAM     │
  │                                         │
  │  Recommended model: Qwen 2.5 7B         │
  │  "Fast, smart, runs great on your Mac"  │
  │                                         │
  │  [ Get Started → ]                      │
  └─────────────────────────────────────────┘
       │
       ▼
  Silently installs Ollama + downloads recommended model
  (progress bar, estimated time, "grab a coffee" messaging)
       │
       ▼
  Chat interface opens. User is talking to AI within minutes.
```

**No decisions required on first run.** We pick the best model for them. Power users can browse the model hub later.

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
| **Local API** | Ollama already serves OpenAI-compatible API. We just surface the endpoint clearly and show copy-paste examples. |
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
OpenLLM/
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
│   │   │   └── Settings.tsx       # Preferences, API info, about
│   │   ├── components/
│   │   │   ├── Sidebar.tsx        # Nav + conversation list
│   │   │   ├── ChatMessage.tsx    # Message bubble w/ markdown
│   │   │   ├── ModelCard.tsx      # Model in the hub
│   │   │   ├── ProgressBar.tsx    # Download progress
│   │   │   ├── UpgradeBanner.tsx  # "New model available" prompt
│   │   │   └── CodeBlock.tsx      # Syntax-highlighted code
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

## 9. Milestones

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

### M3: Model Hub & Upgrades (Week 3)
- [ ] Model hub page with curated cards
- [ ] Category/use-case filtering (not jargon-heavy)
- [ ] Download progress with resume support
- [ ] Registry fetch + upgrade detection
- [ ] Upgrade banner component

### M4: Polish & Ship (Week 4)
- [ ] Electron-builder config for Mac .dmg + Windows .exe
- [ ] GitHub Actions CI/CD pipeline
- [ ] Auto-updater for the app itself
- [ ] System tray / menu bar integration
- [ ] API/Connect page with copy-paste examples
- [ ] Landing page / README
- [ ] First release: v0.1.0

---

## 10. What We're NOT Building

- **A new inference engine.** Ollama handles this. We're a UI + curation layer.
- **A cloud service.** Everything runs locally. No accounts, no telemetry, no data collection.
- **Support for every model.** We curate. Quality over quantity.
- **A mobile app.** Desktop first. Mobile is a different problem.
- **Fine-tuning tools.** Out of scope for MVP. Maybe P2.

---

## 11. Open Questions

1. **Bundle Ollama or require separate install?** Bundling makes UX simpler but increases app size (~100MB) and we need to handle updates. Separate install means one extra step but we always get the latest Ollama. **Recommendation: Auto-download Ollama on first run, don't bundle.**

2. **App name: "OpenLLM" — keep it or change?** The name is clear and memorable. Keep it for now. Can rebrand later.

3. **How opinionated should the default be?** Very. The app should work with zero decisions on first run. Pick the best model for their hardware and go. Expert mode is there but hidden.

4. **How often to check the registry?** On app open + once every 24 hours. Don't be annoying — if user dismisses an upgrade, don't ask again for that same model version.

---

## 12. Competitive Landscape

| Tool | What It Does | Gap We Fill |
|------|-------------|-------------|
| **Ollama (CLI)** | Best runtime, but terminal-only | We add the GUI + curation + auto-upgrade |
| **Open WebUI** | Web-based chat UI for Ollama | Requires running a separate server, Docker, config. Not for normies. |
| **LM Studio** | GUI for local models | Closed source, own inference engine, doesn't auto-upgrade, cluttered UI |
| **GPT4All** | Desktop app for local LLMs | Outdated model selection, no auto-upgrade, clunky |
| **Jan** | Desktop app, open source | Still technical, doesn't curate or auto-recommend |

**Our edge: Opinionated curation + auto-upgrade + dead-simple UX.** We're not trying to be the Swiss Army knife. We're the "it just works" option.

---

## Next Step

Once this plan is approved, I'll start with **M1: Skeleton** — scaffolding the Electron + React project, getting Ollama lifecycle management working, and proving we can go from app launch → model download → streaming chat in a single flow.
