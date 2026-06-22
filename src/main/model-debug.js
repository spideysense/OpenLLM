// ─────────────────────────────────────────────────────────────────────────────
// Model load diagnostics.
//
// We can't see the box's runtime from the dev sandbox, so instead of guessing why
// "Loading … into memory" appears, this logs the ground truth on every stall:
//   * Is the model actually resident? (queries /api/ps)
//   * If resident, does its loaded context_length match what we're sending? A
//     mismatch is what forces Ollama to evict + reload the same model.
//   * If resident with matching ctx, the slow first token is THINKING, not
//     loading — so the status line should say "Thinking…", not "Loading…".
//
// Every line is tagged [MODELDBG] so it's greppable in the box's terminal:
//   grep MODELDBG  (in Aspen's console output)
// ─────────────────────────────────────────────────────────────────────────────
const http = require('http');
const OLLAMA_HOST = '127.0.0.1';
const OLLAMA_PORT = 11434;
const base = (n) => String(n || '').split(':')[0];

function psSnapshot() {
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: OLLAMA_HOST, port: OLLAMA_PORT, path: '/api/ps', method: 'GET' },
      (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { try { resolve(JSON.parse(d).models || []); } catch { resolve([]); } }); }
    );
    req.on('error', () => resolve([]));
    req.setTimeout(2000, () => { req.destroy(); resolve([]); });
    req.end();
  });
}

// Returns { resident, residentCtx, verdict } and logs the verdict. label marks the
// call site (fast / tool / nudge) so a stream of these reads like a trace.
async function diagnose(label, model, requestedCtx) {
  try {
    const resident = await psSnapshot();
    const target = resident.find((m) => base(m.name) === base(model));
    const snap = resident.map((m) => `${m.name}(ctx=${m.context_length},vram=${((m.size_vram || 0) / 1e9).toFixed(1)}GB,exp=${m.expires_at})`);
    let verdict;
    if (!target) {
      verdict = `COLD_LOAD: '${model}' is NOT resident -> will load from disk. Resident now: [${snap.join(', ') || 'none'}]`;
    } else if (target.context_length && requestedCtx && target.context_length !== requestedCtx) {
      verdict = `RELOAD_CAUSE: '${model}' resident at ctx=${target.context_length} but request sends num_ctx=${requestedCtx} -> Ollama reloads. Resident: [${snap.join(', ')}]`;
    } else {
      verdict = `WARM: '${model}' resident at ctx=${target.context_length}, sending num_ctx=${requestedCtx} -> no reload; slow first token = THINKING. Resident: [${snap.join(', ')}]`;
    }
    console.log(`[MODELDBG ${label}] ${verdict}`);
    return { resident: !!target, residentCtx: target?.context_length, verdict };
  } catch (e) {
    console.log(`[MODELDBG ${label}] diagnose failed: ${e.message}`);
    return { resident: false, residentCtx: null, verdict: 'diagnose failed' };
  }
}

module.exports = { diagnose, psSnapshot };
