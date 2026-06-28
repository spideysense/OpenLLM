// Reads Ollama state on the box: which models are resident (loaded in memory)
// and how long they're pinned for — this is how we detect the "Loading qwen
// into memory" eviction regression.
import { cfg } from '../config.js';

export async function ollamaState() {
  const get = async (path) => {
    try { const r = await fetch(`${cfg.ops.ollamaUrl}${path}`, { signal: AbortSignal.timeout(8000) }); return r.ok ? r.json() : null; }
    catch { return null; }
  };
  const ps = await get('/api/ps');     // currently loaded models
  const tags = await get('/api/tags'); // installed models
  return {
    reachable: ps != null,
    resident: (ps?.models || []).map((m) => ({ name: m.name, sizeVram: m.size_vram, expires_at: m.expires_at })),
    installed: (tags?.models || []).map((m) => m.name),
  };
}

export async function gatewayHealth() {
  const t = Date.now();
  try {
    const r = await fetch(`${cfg.ops.gatewayUrl}/v1/models`,
      { headers: { Authorization: `Bearer ${cfg.aspen.apiKey}` }, signal: AbortSignal.timeout(10000) });
    return { ok: r.ok, status: r.status, latencyMs: Date.now() - t };
  } catch (e) { return { ok: false, error: String(e.message || e), latencyMs: Date.now() - t }; }
}
