# 🐻 LLM Bear

**Run the best open source AI locally. No API keys. No subscriptions. No terminal.**

LLM Bear is a desktop app for Mac and Windows that gives anyone one-click access to the world's best open source language models. Modeled after [TunnelBear](https://tunnelbear.com) — same playful energy, same "anyone can use this" ethos. Except instead of tunneling to countries, the bear tunnels to AI models.

> **Status:** Planning phase. See [PLAN.md](PLAN.md) for the project plan and [DESIGN.md](DESIGN.md) for the TunnelBear-inspired design spec.

## Why

You shouldn't have to pay $20/month to talk to an AI. The best open source models now rival GPT-4 and Claude — and they run on your laptop.

The problem is that setting them up requires a terminal, config files, and knowing which of the 100+ available models is actually good. LLM Bear fixes that.

## What It Does

- **One-click install** — Download, open, start chatting. The bear handles everything.
- **Smart model selection** — We detect your hardware and recommend the best model. No research needed.
- **Auto-upgrade** — When a better model drops, the bear tells you and offers a one-click switch.
- **Replace OpenAI / Claude** — Generate API keys (`sk-llmbear-...`), set up model aliases (`gpt-4` → your local model), and drop into existing code by changing two lines.
- **OpenAI-compatible API** — Gateway on `localhost:4000` works with LangChain, Cursor, n8n, and anything OpenAI-compatible.
- **100% local** — Your data never leaves your machine. The bear keeps it in the cave.

## Design

Modeled after TunnelBear's design language:
- 🐻 Friendly bear mascot that guides you through everything
- 🟡 Yellow pipe/tunnel visual metaphor — bear "tunnels" between AI models
- 🗺️ Map-based main view with model "islands" instead of countries
- 🔘 Simple on/off toggle — model running or not
- 🌿 Warm, light, outdoor-y palette — sky blue, grass green, pipe gold
- 💬 Zero jargon — "Get this model" not "Pull the 7B quantized GGUF"

## Project Structure

```
LLMBear/
├── PLAN.md                  # Full project plan and architecture
├── DESIGN.md                # TunnelBear-inspired design specification
├── registry/
│   └── models.json          # Curated best-in-class model registry + alias map
├── src/                     # App source (coming soon)
├── assets/                  # Bear illustrations, icons, branding
└── .github/workflows/       # CI/CD for building installers
```

## License

MIT
