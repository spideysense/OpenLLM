# OpenLLM

**Run the best open source AI locally. No API keys. No subscriptions. No terminal.**

OpenLLM is a desktop app for Mac and Windows that gives anyone one-click access to the world's best open source language models. It auto-detects your hardware, recommends the best model, and keeps you on the latest and greatest — automatically.

> **Status:** Planning phase. See [PLAN.md](PLAN.md) for the full project plan.

## Why

You shouldn't have to pay $20/month to talk to an AI. The best open source models now rival GPT-4 and Claude — and they run on your laptop.

The problem is that setting them up requires a terminal, config files, and knowing which of the 100+ available models is actually good. OpenLLM fixes that.

## What It Does

- **One-click install** — Download, open, start chatting. No terminal.
- **Smart model selection** — We detect your hardware and recommend the best model. No research needed.
- **Auto-upgrade** — When a better model drops, we tell you and offer a one-click switch.
- **OpenAI-compatible API** — Any app that works with OpenAI can point at `localhost:11434` instead. Works with LangChain, Cursor, n8n, and more.
- **100% local** — Your data never leaves your machine.

## Project Structure

```
OpenLLM/
├── PLAN.md                  # Full project plan and architecture
├── registry/
│   └── models.json          # Curated best-in-class model registry
├── src/                     # App source (coming soon)
├── assets/                  # Icons and branding
└── .github/workflows/       # CI/CD for building installers
```

## License

MIT
