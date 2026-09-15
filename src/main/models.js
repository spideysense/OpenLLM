const OLLAMA_HOST = 'http://127.0.0.1:11434';

// ═══════════════════════════════════════════════════
// List installed models
// ═══════════════════════════════════════════════════

async function listModels() {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`);
    if (!res.ok) throw new Error('Failed to list models');
    const data = await res.json();
    return (data.models || []).map((m) => ({
      name: m.name,
      size: m.size,
      sizeGB: (m.size / 1e9).toFixed(1),
      modified: m.modified_at,
      digest: m.digest,
      family: m.details?.family || 'unknown',
      parameterSize: m.details?.parameter_size || '',
      quantization: m.details?.quantization_level || '',
    }));
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════
// Pull (download) a model with progress
// ═══════════════════════════════════════════════════

async function pullModel(modelName, onProgress = () => {}, { signal, allowRetry = true } = {}) {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/pull`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName, stream: true }), signal });
    if (!res.ok) {
      const error = await res.text();
      if (allowRetry && (res.status === 412 || /newer version/.test(error))) {
        const update = await require('./ollama').ensureCurrent(msg => onProgress({ status: msg, phase: 'engine', percent: 0 }), { force: true });
        if (update.success) return pullModel(modelName, onProgress, { signal, allowRetry: false });
      }
      throw new Error(error || `Download failed (${res.status})`);
    }
    const layers = new Map(); let success = false;
    for await (const json of require('./ndjson').records(res.body)) {
      signal?.throwIfAborted();
      if (json.error) throw new Error(json.error);
      if (json.digest && json.total) layers.set(json.digest, { total: json.total, completed: json.completed || 0 });
      let total = 0, completed = 0; for (const l of layers.values()) { total += l.total; completed += l.completed; }
      const rawStatus = json.status || '';
      success = success || rawStatus === 'success';
      const phase = success ? 'done' : /^verifying/.test(rawStatus) ? 'verifying' : /^writing|^removing/.test(rawStatus) ? 'finalizing' : 'downloading';
      onProgress({ status: rawStatus, rawStatus, phase, total, completed, percent: success ? 100 : total ? Math.min(99, Math.round(100 * completed / total)) : 0 });
    }
    if (!success) throw new Error('Download interrupted before verification completed. Try again to resume.');
    const installed = await listModels();
    const id = require('./model-id').normalize(modelName);
    if (!installed.some(m => require('./model-id').normalize(m.name) === id)) throw new Error('The downloaded model is not installed. Try again.');
    return { success: true };
  } catch (error) { return { success: false, aborted: signal?.aborted || false, error: error.message }; }
}

// ═══════════════════════════════════════════════════
// Delete a model
// ═══════════════════════════════════════════════════

async function deleteModel(modelName) {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName }),
    });
    return { success: res.ok };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════
// Get running models
// ═══════════════════════════════════════════════════

async function getRunningModels() {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/ps`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.models || [];
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════
// Recommend a model based on hardware tier + registry
// ═══════════════════════════════════════════════════

function getRecommendation(tier, registry, { memoryGB = Infinity } = {}) {
  // Schema v3: flat power-ranked list. Best model the machine can run = the
  // first runnable entry (registry is ordered most→least capable).
  if (Array.isArray(registry?.models)) {
    const TIER_ORDER = { light: 1, medium: 2, heavy: 3, ultra: 4 };
    const cap = TIER_ORDER[tier] || 2;
    const best = registry.models.find((m) => !m.deprecated && Number(m.download_gb) <= memoryGB && (TIER_ORDER[m.min_tier] || 2) <= cap);
    if (best) {
      return { model: best.model, name: best.name, provider: best.provider, why: best.why, sizeGB: String(best.download_gb) };
    }
  }
  // Fallback (registry unavailable) — tool-capable defaults.
  const fallbacks = {
    // On unified-memory boxes generation speed is bound by MEMORY BANDWIDTH, so
    // what governs speed is ACTIVE params, not total. But raw speed/benchmarks are
    // not the whole story: the default must be MULTIMODAL (Aspen has vision) and
    // reliable at tool-calling. gpt-oss-120b was fast but is text-only and weak at
    // tools in practice, so it's intentionally NOT the default. Qwen3.6 35B-A3B is
    // the reliable pick (vision + tools, 3B active = fast). qwen3.5 (122B/~10B
    // active) is the optional heavier upgrade — more per-token reasoning, slower.
    light: { model: 'llama3.2:3b', name: 'Llama 3.2 3B', why: 'Fast, tool-capable, runs anywhere', sizeGB: '2.0' },
    medium: { model: 'qwen2.5:7b', name: 'Qwen 2.5 7B', why: 'Reliable tools, great quality', sizeGB: '4.7' },
    heavy: { model: 'qwen3.6:35b-a3b', name: 'Qwen3.6 35B-A3B', why: 'MoE, 3B active — fast, reliable, with vision + tools', sizeGB: '23' },
    ultra: { model: 'qwen3.6:35b-a3b', name: 'Qwen3.6 35B-A3B', why: 'Reliable + fast + multimodal; qwen3.5 available as a heavier optional upgrade', sizeGB: '23' },
  };
  const preferred = fallbacks[tier] || fallbacks.medium;
  return [preferred, fallbacks.medium, fallbacks.light].find(m => Number(m.sizeGB) <= memoryGB) || null;
}

module.exports = {
  listModels,
  pullModel,
  deleteModel,
  getRunningModels,
  getRecommendation,
};
