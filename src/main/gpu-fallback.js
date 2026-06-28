// ─────────────────────────────────────────────────────────────────────────────
// GPU runtime failure detection + automatic CPU fallback.
//
// Some user GPUs crash llama-server the instant a model loads — the bundled CUDA
// kernels don't include code for that card's compute capability (too new, e.g.
// Blackwell sm_120; too old; or a mismatched CUDA runtime). This is baked into
// the binary at build time, so updating drivers can't fix it. Symptom:
//   "CUDA error: device kernel image is invalid"
//   "llama-server process has terminated: exit status 0xc0000409"
//
// Rather than maintain an allowlist of "supported" GPUs (which rots and can't
// predict future cards), we try the GPU, catch the runtime crash, and fall back
// to CPU automatically — covering all three variants with one mechanism. The
// box keeps working (slower) instead of dead-ending. This module is a pure leaf
// (no electron, no http) so it's shared by the desktop and gateway paths in the
// same process and is fully unit-testable.
// ─────────────────────────────────────────────────────────────────────────────

// Durable signatures of a GPU runtime crash (vs an ordinary app-level error).
// Matched case-insensitively against the Ollama error body / thrown message.
// Out-of-memory is a SIZING problem ("this model is too big for VRAM"), not a
// broken GPU. It must never flip the permanent CPU flag, or one oversized model
// poisons every smaller model after it. Detected separately so the caller can
// fall back to CPU for THIS call only.
function isGpuOom(text) {
  const t = String((text && text.message) || text || '').toLowerCase();
  if (!t) return false;
  return t.includes('out of memory') &&
    (t.includes('cuda') || t.includes('cublas') || t.includes('gpu') || t.includes('vram') || t.includes('ggml'));
}

function isGpuRuntimeFailure(text) {
  const t = String((text && text.message) || text || '').toLowerCase();
  if (!t) return false;
  if (isGpuOom(t)) return false;                      // OOM = sizing, not a dead GPU
  return (
    t.includes('cuda error') ||
    t.includes('device kernel image is invalid') ||
    t.includes('no kernel image is available') ||
    t.includes('0xc0000409') ||                      // Windows stack-buffer overrun
    t.includes('llama-server process has terminated') ||
    t.includes('ggml_cuda') ||
    t.includes('cublas') ||
    t.includes('cudnn')
  );
}

// Process-level flag. Desktop (ollama.js) and gateway (gateway-agent.js) run in
// the same main process, so flipping this once makes every later call — on both
// paths — skip the GPU.
let FORCE_CPU = false;

function forceCpu() { return FORCE_CPU; }
function setForceCpu(on) { FORCE_CPU = !!on; }
function resetForceCpu() { FORCE_CPU = false; } // tests only

// Ollama option that offloads zero layers to the GPU = pure CPU inference.
// Merge into the `options` of any /api/chat body. Empty object when GPU is fine
// so we don't perturb the normal path.
function gpuOptions() { return FORCE_CPU ? { num_gpu: 0 } : {}; }

// User-facing copy — never show the raw CUDA / stack-overflow string to a person.
const GPU_FALLBACK_MESSAGE =
  "Your graphics card can't run AI models on this machine, so Aspen switched to " +
  "CPU mode. It still works, just slower. (Updating your graphics driver may " +
  're-enable faster GPU mode.)';

// Run `attempt(extraOpts)` once with current GPU options. If it fails with a GPU
// runtime crash, flip the box to CPU and run exactly once more with num_gpu:0.
// Transport-agnostic (attempt does the actual http) so it's unit-testable with a
// plain fake. Non-GPU errors propagate unchanged.
async function withGpuFallback(attempt) {
  try {
    return await attempt(gpuOptions());
  } catch (e) {
    // OOM: model too big for VRAM. Run THIS call on CPU, but do NOT demote the
    // session — a smaller model should still get a clean GPU attempt next.
    if (!FORCE_CPU && isGpuOom(e)) {
      return await attempt({ num_gpu: 0 });
    }
    // Hard GPU runtime crash (dead kernels): demote the whole session to CPU.
    if (!FORCE_CPU && isGpuRuntimeFailure(e)) {
      setForceCpu(true);
      return await attempt({ num_gpu: 0 }); // single CPU retry
    }
    throw e;
  }
}

module.exports = {
  isGpuRuntimeFailure,
  isGpuOom,
  forceCpu,
  setForceCpu,
  resetForceCpu,
  gpuOptions,
  withGpuFallback,
  GPU_FALLBACK_MESSAGE,
};
