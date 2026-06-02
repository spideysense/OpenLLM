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
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName, stream: true }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(err);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value, { stream: true });
      const lines = text.split('\n').filter(Boolean);

      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          onProgress({
            status: json.status || '',
            completed: json.completed || 0,
            total: json.total || 0,
            percent: json.total ? Math.round((json.completed / json.total) * 100) : 0,
          });
        } catch {
          // Skip
        }
      }
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
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
    light: { model: 'llama3.2:3b', name: 'Llama 3.2 3B', why: 'Fast, tool-capable, runs anywhere', sizeGB: '2.0' },
    medium: { model: 'qwen2.5:7b', name: 'Qwen 2.5 7B', why: 'Reliable tools, great quality', sizeGB: '4.7' },
    heavy: { model: 'qwen2.5:32b', name: 'Qwen 2.5 32B', why: 'GPT-4-class with solid tools', sizeGB: '20' },
    ultra: { model: 'llama4:scout', name: 'Llama 4 Scout', why: "Meta's open flagship", sizeGB: '65' },
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
