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

Two refinements the first pass missed, both load-bearing:

1. **MLX replaces inference only.** `/api/tags`, `/api/pull`, `/api/delete`, `/api/ps`
   are Ollama-specific with no MLX equivalent (mlx-lm pulls from HuggingFace). Only
   chat/generate ever routes to MLX. `backend.managementBackend()` is always Ollama.
2. **It's an API translation, not a host swap.** mlx_lm.server speaks OpenAI
   `/v1/chat/completions`; the gateway speaks Ollama-native `/api/chat` (with `think`,
   `keep_alive`, native object-form `tool_calls`). So MLX needs an adapter that
   translates request options and stream deltas between the two shapes.

```
Chat path ─▶ backend.inferenceBackend(pref)
                │  (Apple Silicon AND enabled AND mlx healthy AND model mapped?)
        ┌───────┴────────┐
        ▼                ▼
   Ollama /api/chat   mlx.chat() ──▶ mlx_lm.server :8081 /v1/chat/completions
   (unchanged)        (OpenAI adapter, same event shape back to the gateway)

Model mgmt ─▶ backend.managementBackend()  ─▶ always Ollama
```

## What is built (in repo, tested where testable)

- [x] `src/main/backend.js` — `inferenceBackend(pref)` (MLX-health-aware) and
      `managementBackend()` (always Ollama). Defaults to Ollama; verified inert off-Mac.
- [x] `src/main/mlx.js` — the whole MLX subsystem, isolated:
      - Pure (unit-tested, `tests/main/mlx.test.js`, 11/11): `mlxModelFor` (mapping,
        null for unmapped so we stay on Ollama), `serverArgs`, `toOpenAIChatBody`
        (num_predict→max_tokens, drops keep_alive/think), `parseOpenAISSELine`.
      - Lifecycle (Mac-only, untestable here): `ensureRunning`/`stop`/`health`/`status`,
        spawn + health-poll + crash handling, fail-closed to Ollama.
      - `chat()` async-generator adapter: yields the SAME `{kind:'content'|'tools'|'done'}`
        events the gateway already consumes, so the call site swap is minimal.

## Phase 1 — remaining, MUST be done & tested on Apple Silicon

1. **Wire the seam.** At the gateway's inference call site (`ollamaStreamTools` in
   gateway-agent.js), branch once: `if (backend.inferenceBackend(pref).kind === 'mlx')
   yield* mlx.chat(model, convo, { tools, options }); else <existing Ollama path>`.
   The existing Ollama path stays untouched; MLX is an additive branch.
2. **Settings toggle + IPC.** A Settings switch (visible only when `isAppleSilicon()`):
   on enable, `await mlx.ensureRunning(activeModel)`; if it returns false, surface
   `mlx.status().lastError` (e.g. "pip install mlx-lm") and leave pref on Ollama.
3. **Model coverage.** Extend `MLX_MODEL_MAP` for whatever models you ship; unmapped
   models intentionally stay on Ollama (no guessing repos that may not exist).
4. **Switch handling.** Changing models calls `ensureRunning` again (mlx_lm.server is
   one-model-at-a-time); it restarts the server for the new model.

## Mac validation (cannot be done from Linux)
1. `pip install mlx-lm`
2. `python3 -m mlx_lm.server --model mlx-community/Qwen3-32B-4bit --port 8081`
3. `curl localhost:8081/v1/chat/completions -d '{"model":"mlx-community/Qwen3-32B-4bit","messages":[{"role":"user","content":"hi"}],"stream":true}'`
   — confirm it STREAMS with the buttery cadence, and tools round-trip.
4. Measure tok/s vs the same model on Ollama. Confirm the 30-50% gain is real on YOUR
   chip before exposing the toggle. If marginal, don't ship Phase 2 packaging.
5. Only then wire the seam (step 1 above) and test the toggle end to end.

## Phase 2 — bundle the runtime (defer until Phase 1 proven)
Ship a frozen `mlx_lm.server` (PyInstaller) or an app-managed `uv` venv so users never
touch Python. `ASPEN_MLX_PYTHON` env already lets the lifecycle point at a bundled binary.

## Honest caveats
- Apple Silicon + macOS 14+ only. No effect anywhere else.
- v1 assumes Python is present (or bundled in Phase 2).
- MLX models are a separate download from GGUF. Disk cost is additive.
- Metal can OOM and kill the server on large prompts/contexts. Phase 1 must handle the
  crash and fall back, not hang.
- None of this is testable from the Linux dev sandbox. Treat all Phase 1 code as
  unverified until it runs on a Mac.
