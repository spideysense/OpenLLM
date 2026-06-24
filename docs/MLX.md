# MLX support (Apple Silicon acceleration)

Goal: on Apple Silicon Macs, run inference through Apple's MLX runtime instead of
Ollama/llama.cpp for roughly 30 to 50 percent higher tokens per second on the same
hardware. Everywhere else (Windows, Linux, Intel Macs) stays on Ollama, unchanged.

This is a subsystem, not a setting. It is Apple Silicon only and cannot be built or
tested on Linux. Nothing here ships to users until it is tested on a real M-series Mac.

## Verified tooling (do not guess these, they were checked)

- Official runtime: `mlx-lm` (ml-explore/mlx-lm). `pip install mlx-lm`.
- OpenAI-compatible server, one command:
  `mlx_lm.server --model mlx-community/<model> --port 8081`
  Serves `/v1/chat/completions`, `/v1/models`. Same wire shape the gateway already speaks.
- Models: MLX format from the `mlx-community` org on Hugging Face (4bit/8bit). They
  auto-download on first use. GGUF files are NOT reusable; MLX is a separate format.
  Convert from HF if needed: `mlx_lm.convert --hf-path <repo> -q`.
- Requirements: macOS 14+, Apple Silicon, Python 3.11+.
- Fancier alternatives if we ever outgrow mlx-lm: `mlx-openai-server` (FastAPI, tool-call
  parsers, multimodal) and `vllm-mlx` (continuous batching, 400+ tok/s). Not v1.

## The hard part, stated plainly

mlx-lm is Python. Ollama ships as one self-contained binary; MLX does not. The real
work is getting a Python runtime + mlx-lm onto the user's Mac and supervising that
process. That is the packaging problem, and it is the bulk of the effort. The routing
and streaming are easy because mlx_lm.server is already OpenAI-shaped.

## Architecture

Single seam: `src/main/backend.js` resolves the upstream `{host, port}` for the active
backend. Default is Ollama. On Apple Silicon, when MLX is enabled AND its server is
confirmed healthy, the resolver returns the MLX host/port instead. Every place in
`main/` that currently hardcodes `127.0.0.1:11434` reads from this resolver instead.

```
Chat UI ──▶ Gateway (OpenAI format, unchanged)
                │
                ▼  backend.resolveBackend()
        ┌───────┴────────┐
        ▼                ▼
   Ollama :11434    mlx_lm.server :8081   (Apple Silicon, opt-in, healthy)
```

The gateway does not care which one answers; both speak `/v1/chat/completions` with SSE
streaming. That is the whole point of routing at the backend, not the app, layer.

## Phases

### Phase 0 — foundation (in repo now, inert, zero risk)
- [x] `src/main/backend.js`: backend constants, `isAppleSilicon()`, `resolveBackend()`.
      Defaults to Ollama always. Not yet wired into the hardcoded references, so the
      live app is unchanged.

### Phase 1 — opt-in routing (Mac, the real v1)
Bring-your-own MLX first. Sidesteps bundling so Mac power users get the speedup now.
1. Settings toggle: "Apple Silicon acceleration (MLX) — experimental." Visible only
   when `isAppleSilicon()`.
2. On enable: detect `python3` + `mlx_lm`. If missing, show the one-line install hint
   (`pip install mlx-lm`) rather than failing silently.
3. Spawn `mlx_lm.server --model <mlx-model> --port 8081`. Health-check `GET /v1/models`
   before flipping the backend. Persist a per-model handle; serialize model switches.
4. Flip the resolver: set backend pref to `mlx`, `mlxHealthy=true`. The four call sites
   now route to :8081.
5. Model mapping: maintain MLX equivalents (`mlx-community/...`) for the catalog. Pull
   via mlx_lm auto-download with progress.
6. Fallback discipline: ANY failure (spawn, health, OOM, crash) reverts to Ollama and
   surfaces a clear message. Never leave the user with a dead chat.

### Phase 2 — bundle the runtime (polish, defer)
Ship a frozen `mlx_lm.server` (PyInstaller) or an app-managed `uv` venv so users never
touch Python. This is the fiddly Mac packaging work. Defer until Phase 1 is proven.

## Integration points (the four hardcoded references)
Replace the literal `OLLAMA_HOST`/`OLLAMA_PORT` with `backend.resolveBackend()`:
- `src/main/gateway.js` (the streaming chat path — change minimally, test streaming smoothness on Mac before shipping)
- `src/main/gateway-agent.js`
- `src/main/world-model.js`
- `src/main/models.js`

## Mac-side manual steps (cannot be done or verified from Linux)
1. `pip install mlx-lm` (or `uv pip install mlx-lm`).
2. Manually verify the server:
   `mlx_lm.server --model mlx-community/Qwen2.5-7B-Instruct-4bit --port 8081`
   then `curl localhost:8081/v1/chat/completions` with a test message.
3. Confirm it STREAMS (SSE) the same way Ollama does, with the buttery cadence intact.
4. Measure tokens/sec vs the same model on Ollama. Confirm the 30 to 50 percent gain is
   real on your hardware before exposing the toggle.
5. Only then wire the resolver into the four files and test the Settings toggle end to end.

## Honest caveats
- Apple Silicon + macOS 14+ only. No effect anywhere else.
- v1 assumes Python is present (or bundled in Phase 2).
- MLX models are a separate download from GGUF. Disk cost is additive.
- Metal can OOM and kill the server on large prompts/contexts. Phase 1 must handle the
  crash and fall back, not hang.
- None of this is testable from the Linux dev sandbox. Treat all Phase 1 code as
  unverified until it runs on a Mac.
