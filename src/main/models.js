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

async function pullModel(modelName, onProgress) {
  return _pullModelInner(modelName, onProgress, true);
}

async function _pullModelInner(modelName, onProgress, allowRetry) {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName, stream: true }),
    });

    // Engine too old for this model — auto-update and retry.
    // Ollama sends this as HTTP 412, or as a non-200 with "412" / "newer version" in the body.
    if (!res.ok && allowRetry) {
      const errText = await res.text();
      if (res.status === 412 || errText.includes('412') || errText.includes('newer version')) {
        onProgress({ status: 'Updating engine for this model...', completed: 0, total: 0, percent: 0 });
        try {
          const ollama = require('./ollama');
          const result = await ollama.ensureCurrent((msg) => onProgress({ status: msg, completed: 0, total: 0, percent: 0 }), { force: true });
          if (result.success) return _pullModelInner(modelName, onProgress, false);
        } catch {}
        return { success: false, error: 'Could not update engine. Please restart Aspen and try again.' };
      }
      throw new Error(errText.replace(/[Oo]llama/g, 'engine'));
    }

    if (!res.ok) {
      const err = await res.text();
      throw new Error(err.replace(/[Oo]llama/g, 'engine'));
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let lastError = null;
    let sawSuccess = false;
    // Ollama reports progress per layer/blob. Track every layer's bytes so the
    // bar reflects the WHOLE pull, not just whichever blob is currently moving
    // (otherwise it races to ~100% on the big blob while others remain).
    const layers = {};

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value, { stream: true });
      const lines = text.split('\n').filter(Boolean);

      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          // Ollama streams errors as {"error":"..."} with HTTP 200, then closes.
          if (json.error) {
            // Auto-update on version error streamed as JSON
            if (allowRetry && json.error.includes('requires a newer version')) {
              onProgress({ status: 'Updating engine for this model...', completed: 0, total: 0, percent: 0, phase: 'engine' });
              try {
                const ollama = require('./ollama');
                const result = await ollama.ensureCurrent((msg) => onProgress({ status: msg, completed: 0, total: 0, percent: 0, phase: 'engine' }), { force: true });
                if (result.success) return _pullModelInner(modelName, onProgress, false);
                return { success: false, error: 'Could not update engine. Please restart Aspen and try again.' };
              } catch (updateErr) {
                return { success: false, error: 'Could not update engine. Please restart Aspen and try again.' };
              }
            }
            lastError = json.error.replace(/[Oo]llama/g, 'engine');
            continue;
          }
          if (json.status === 'success') sawSuccess = true;

          const rawStatus = json.status || '';
          // Accumulate this layer's bytes (keyed by digest) for an aggregate %.
          if (json.digest && json.total) {
            layers[json.digest] = { completed: json.completed || 0, total: json.total };
          }
          let aggCompleted = 0, aggTotal = 0;
          for (const k in layers) { aggCompleted += layers[k].completed; aggTotal += layers[k].total; }

          // Classify the phase. The tail phases (verify/finalize) have no bytes,
          // so we must NOT leave a frozen download number on screen.
          let phase = 'downloading';
          let label = rawStatus;
          if (/^verifying/i.test(rawStatus)) { phase = 'verifying'; label = 'Verifying download…'; }
          else if (/manifest/i.test(rawStatus)) { phase = 'finalizing'; label = 'Finalizing…'; }
          else if (rawStatus === 'success') { phase = 'done'; label = 'Done'; }
          else if (/^pulling manifest/i.test(rawStatus)) { phase = 'downloading'; label = 'Preparing download…'; }
          else if (/^(pulling|downloading)/i.test(rawStatus)) { label = 'Downloading model…'; }

          const percent = phase === 'done' ? 100
            : aggTotal ? Math.min(99, Math.round((aggCompleted / aggTotal) * 100))
            : 0;

          onProgress({
            status: label,
            rawStatus,
            phase,
            completed: aggCompleted,
            total: aggTotal,
            percent,
          });
        } catch {
          // Skip
        }
      }
    }

    if (lastError) return { success: false, error: lastError };
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message.replace(/[Oo]llama/g, 'engine') };
  }
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

function getRecommendation(tier, registry) {
  // Schema v3: flat power-ranked list. Best model the machine can run = the
  // first runnable entry (registry is ordered most→least capable).
  if (Array.isArray(registry?.models)) {
    const TIER_ORDER = { light: 1, medium: 2, heavy: 3, ultra: 4 };
    const cap = TIER_ORDER[tier] || 2;
    const best = registry.models.find((m) => (TIER_ORDER[m.min_tier] || 2) <= cap);
    if (best) {
      return { model: best.model, name: best.name, provider: best.provider, why: best.why, sizeGB: String(best.download_gb) };
    }
  }
  // Fallback (registry unavailable) — tool-capable defaults.
  const fallbacks = {
    // On unified-memory boxes (Mac / DGX Spark-class) generation speed is bound
    // by MEMORY BANDWIDTH, so what matters is ACTIVE params, not total. Low-active
    // MoE models give big-model quality at small-model speed. Dense 32B/70B models
    // are avoided here — they measure single-digit tok/s on this class of hardware.
    light: { model: 'llama3.2:3b', name: 'Llama 3.2 3B', why: 'Fast, tool-capable, runs anywhere', sizeGB: '2.0' },
    medium: { model: 'qwen2.5:7b', name: 'Qwen 2.5 7B', why: 'Reliable tools, great quality', sizeGB: '4.7' },
    heavy: { model: 'qwen3.6:35b-a3b', name: 'Qwen3.6 35B-A3B', why: 'MoE, only 3B active — fast, with vision + tools', sizeGB: '23' },
    ultra: { model: 'gpt-oss:120b', name: 'GPT-OSS 120B', why: '120B brain, ~5B active — big-model quality at small-model speed; strong tool use', sizeGB: '66' },
  };
  return fallbacks[tier] || fallbacks.medium;
}

module.exports = {
  listModels,
  pullModel,
  deleteModel,
  getRunningModels,
  getRecommendation,
};
