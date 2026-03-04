# 🐻 LLM Bear

**Run the best open source AI locally. No API keys. No subscriptions. No terminal.**

LLM Bear is a desktop app for Mac and Windows that gives anyone one-click access to the world's best open source language models. Modeled after [TunnelBear](https://tunnelbear.com) — same playful energy, same "anyone can use this" ethos. Except instead of tunneling to countries, the bear tunnels to AI models.

## Quick Start

```bash
# Clone the repo
git clone https://github.com/spideysense/OpenLLM.git
cd OpenLLM

# Install dependencies
npm install

# Run in dev mode (Electron + Vite hot reload)
npm run dev

# Build for Mac
npm run build:mac

# Build for Windows
npm run build:win
```

**Prerequisites:** Node.js 20+, [Ollama](https://ollama.com) installed on your machine.

## What It Does

- **One-click install** — Download, open, chat. The bear handles everything.
- **Smart model selection** — Detects your hardware and recommends the best model automatically.
- **Auto-upgrade** — When a better model drops, the bear tells you and offers a one-click switch.
- **Replace OpenAI / Claude** — Generate API keys (`sk-llmbear-...`), alias `gpt-4` to your local model, drop into existing code by changing two lines.
- **OpenAI-compatible API** — Gateway on `localhost:4000` works with LangChain, Cursor, n8n, and anything OpenAI-compatible.
- **100% local** — Your data never leaves your machine. The bear keeps it in the cave.

## Architecture

```
                Your App (any OpenAI SDK)
                         │
                    port 4000
                         │
              ┌──────────┴──────────┐
              │   LLM Bear Gateway  │
              │  Auth · Aliasing    │
              │  gpt-4 → qwen2.5   │
              └──────────┬──────────┘
                         │
                    port 11434
                         │
              ┌──────────┴──────────┐
              │     Ollama          │
              │  (managed silently) │
              └─────────────────────┘
```

## Project Structure

```
OpenLLM/
├── package.json                  # Electron + Vite + React
├── vite.config.js                # Vite build config
├── registry/
│   └── models.json               # Curated model registry + alias defaults
├── src/
│   ├── main/                     # Electron main process
│   │   ├── index.js              # App entry, window management, IPC handlers
│   │   ├── ollama.js             # Ollama lifecycle (install, start, stop, chat)
│   │   ├── models.js             # Model management (list, pull, delete, recommend)
│   │   ├── system.js             # Hardware detection (GPU, RAM, tier classification)
│   │   ├── gateway.js            # API gateway (port 4000, auth, aliasing, proxy)
│   │   ├── apikeys.js            # API key generation + validation
│   │   ├── aliases.js            # Model alias resolution (gpt-4 → local)
│   │   ├── registry.js           # Fetch + compare curated model registry
│   │   └── store.js              # Persistent local JSON storage
│   ├── preload/
│   │   └── index.js              # IPC bridge (contextBridge)
│   └── renderer/                 # React UI
│       ├── index.html            # HTML entry
│       ├── main.jsx              # React root
│       ├── App.jsx               # Router, state management, layout
│       ├── styles.css             # TunnelBear-inspired global theme
│       ├── components/
│       │   └── Sidebar.jsx       # Navigation sidebar
│       └── pages/
│           ├── Onboarding.jsx    # First-run wizard
│           ├── Chat.jsx          # Chat interface with streaming
│           ├── ModelHub.jsx      # Browse + download models
│           ├── ReplaceWizard.jsx # "Replace OpenAI" step-by-step
│           ├── APIKeys.jsx       # Generate + manage API keys
│           └── Settings.jsx      # Aliases, system info, preferences
├── site/
│   └── index.html                # Landing page (llmbear.com)
├── PLAN.md                       # Full project plan
├── DESIGN.md                     # TunnelBear-inspired design spec
└── .github/workflows/
    └── build.yml                 # CI/CD for Mac .dmg + Windows .exe
```

## Design

Modeled after TunnelBear's design language. See [DESIGN.md](DESIGN.md) for the full spec.

- 🐻 Friendly bear mascot guiding every interaction
- 🟡 Yellow pipe/tunnel visual metaphor
- 🗺️ Landscape-based main view
- 💬 Zero jargon ("Get this model" not "Pull the 7B GGUF")
- 🎨 Baloo 2 + Nunito fonts, sky blue / pipe yellow / grass green palette

## Plans

| Plan | Price | What |
|------|-------|------|
| **Cave Bear** | Free forever | Run locally on your machine, all features, no support |
| **Cloud Bear** | $0.99/mo | We host it for you, no downloads needed |
| **Grizzly Bear** | $1.99/mo | Priority cloud + human email support |

## License

MIT — Fork it, modify it, ship it. Go wild.
