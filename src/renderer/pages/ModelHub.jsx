import React, { useState, useEffect } from 'react';
import { useApp } from '../App';

// Curated model catalog — matches registry/models.json
const CATALOG = [
  {
    category: 'General Purpose',
    icon: '💬',
    models: [
      { id: 'llama3.2:3b', name: 'Llama 3.2 3B', provider: 'Meta', sizeGB: '2.0', tier: 'light', why: 'Fast on any machine, great for simple tasks' },
      { id: 'qwen2.5:7b', name: 'Qwen 2.5 7B', provider: 'Alibaba', sizeGB: '4.7', tier: 'medium', why: 'Top-rated small model, best everyday AI' },
      { id: 'qwen2.5:32b', name: 'Qwen 2.5 32B', provider: 'Alibaba', sizeGB: '19', tier: 'heavy', why: 'Rivals GPT-4 quality' },
      { id: 'llama3.3', name: 'Llama 3.3 70B', provider: 'Meta', sizeGB: '40', tier: 'ultra', why: "Meta's flagship, rivals commercial models" },
    ],
  },
  {
    category: 'Coding',
    icon: '👨‍💻',
    models: [
      { id: 'qwen2.5-coder:3b', name: 'Qwen Coder 3B', provider: 'Alibaba', sizeGB: '1.9', tier: 'light', why: 'Quick code completion and simple scripts' },
      { id: 'qwen2.5-coder:7b', name: 'Qwen Coder 7B', provider: 'Alibaba', sizeGB: '4.7', tier: 'medium', why: 'Best small coding model, multi-language' },
      { id: 'qwen2.5-coder:32b', name: 'Qwen Coder 32B', provider: 'Alibaba', sizeGB: '19', tier: 'heavy', why: 'Production-grade code generation' },
      { id: 'deepseek-coder-v2', name: 'DeepSeek Coder V2', provider: 'DeepSeek', sizeGB: '8.9', tier: 'medium', why: 'Specialized for complex codebases' },
    ],
  },
  {
    category: 'Reasoning',
    icon: '🧠',
    models: [
      { id: 'deepseek-r1:7b', name: 'DeepSeek R1 7B', provider: 'DeepSeek', sizeGB: '4.7', tier: 'medium', why: 'Chain-of-thought reasoning, thinks step by step' },
      { id: 'deepseek-r1:14b', name: 'DeepSeek R1 14B', provider: 'DeepSeek', sizeGB: '9.0', tier: 'medium', why: 'Strong math and logic problem solving' },
      { id: 'deepseek-r1:32b', name: 'DeepSeek R1 32B', provider: 'DeepSeek', sizeGB: '19', tier: 'heavy', why: 'Rivals o1 on reasoning benchmarks' },
    ],
  },
  {
    category: 'Creative Writing',
    icon: '✍️',
    models: [
      { id: 'llama3.2:3b', name: 'Llama 3.2 3B', provider: 'Meta', sizeGB: '2.0', tier: 'light', why: 'Good for quick creative prompts' },
      { id: 'gemma2:9b', name: 'Gemma 2 9B', provider: 'Google', sizeGB: '5.4', tier: 'medium', why: 'Excellent creative and narrative writing' },
      { id: 'llama3.3', name: 'Llama 3.3 70B', provider: 'Meta', sizeGB: '40', tier: 'ultra', why: 'Best overall creative quality' },
    ],
  },
];

export default function ModelHub() {
  const { bridge, models, refreshModels, hardwareTier, selectModel, setPage } = useApp();
  // Per-model download state, keyed by model id, so multiple models can download
  // at once without clobbering each other. Each entry: { progress, status, eta }.
  const [pulls, setPulls] = useState({});
  const pullMetaRef = React.useRef({}); // per-model { startTime, lastPct } for ETA + monotonic smoothing

  const installedNames = models.map((m) => m.name);

  useEffect(() => {
    if (!bridge) return;
    const unsub = bridge.models.onPullProgress((data) => {
      const id = data.model;
      if (!id) return;
      setPulls((prev) => {
        const cur = prev[id] || { progress: 0, status: '', eta: null };
        let pct = cur.progress;
        if (data.total > 0 && typeof data.percent === 'number') {
          // Only ever move forward — Ollama reports per-layer progress that can
          // jump backward between layers, which is what made the bar flicker.
          pct = Math.max(cur.progress, data.percent);
        }
        // ETA per model
        const meta = pullMetaRef.current[id] || (pullMetaRef.current[id] = { startTime: Date.now() });
        let eta = cur.eta;
        const elapsed = (Date.now() - meta.startTime) / 1000;
        if (elapsed > 2 && pct > 1) {
          const totalEstSec = elapsed / (pct / 100);
          const remaining = Math.max(0, totalEstSec - elapsed);
          const speed = data.completed ? (data.completed / 1e6 / elapsed).toFixed(1) : null;
          eta = { remaining: Math.round(remaining), speed };
        }
        return { ...prev, [id]: { progress: pct, status: data.status || cur.status, eta } };
      });
    });
    return unsub;
  }, [bridge]);

  async function handlePull(modelId) {
    if (!bridge) return;
    // Already downloading this one? Ignore the re-click.
    if (pulls[modelId]) return;
    pullMetaRef.current[modelId] = { startTime: Date.now() };
    setPulls((prev) => ({ ...prev, [modelId]: { progress: 0, status: 'Starting…', eta: null } }));

    await bridge.ollama.ensureRunning();
    const result = await bridge.models.pull(modelId);

    if (result.success) {
      await refreshModels();
      selectModel(modelId);
    }

    // Clear this model's download state (leave any other in-flight downloads alone).
    setPulls((prev) => { const n = { ...prev }; delete n[modelId]; return n; });
    delete pullMetaRef.current[modelId];
  }

  async function handleDelete(modelId) {
    if (!bridge) return;
    if (!confirm(`Remove ${modelId}? You can re-download it later.`)) return;
    await bridge.models.delete(modelId);
    await refreshModels();
  }

  function isInstalled(modelId) {
    return installedNames.some((n) => n === modelId || n.startsWith(modelId.split(':')[0]));
  }

  const tierOrder = { light: 0, medium: 1, heavy: 2, ultra: 3 };
  const userTierIdx = tierOrder[hardwareTier] ?? 1;

  function canRun(tier) {
    return (tierOrder[tier] ?? 0) <= userTierIdx;
  }

  return (
    <div className="page">
      <div className="page-title">Models</div>
      <div className="page-sub">
        Aspen picked these for you. Your machine: <strong>{hardwareTier}</strong> tier.
      </div>

      {CATALOG.map((cat) => (
        <div key={cat.category} style={{ marginBottom: 36 }}>
          <h3 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 18,
            fontWeight: 700,
            color: 'var(--earth)',
            marginBottom: 12,
          }}>
            {cat.icon} {cat.category}
          </h3>

          <div className="model-grid">
            {cat.models.map((model) => {
              const installed = isInstalled(model.id);
              const pullState = pulls[model.id];
              const isPulling = !!pullState;
              const fitsHardware = canRun(model.tier);

              return (
                <div
                  key={model.id}
                  className={`model-card ${fitsHardware && !installed ? 'recommended' : ''}`}
                  style={{ opacity: fitsHardware ? 1 : 0.55 }}
                >
                  <div className="model-card-header">
                    <div>
                      <h3>{model.name}</h3>
                      <div className="model-meta">{model.provider} · {model.sizeGB} GB</div>
                    </div>
                    {installed && <span className="badge badge-green">Installed</span>}
                    {!installed && fitsHardware && !isPulling && (
                      <span className="badge badge-yellow">★ Fits</span>
                    )}
                    {!fitsHardware && !installed && (
                      <span className="badge" style={{ background: 'rgba(93,78,55,0.06)', color: 'var(--text-light)' }}>
                        Too big
                      </span>
                    )}
                  </div>

                  <p style={{ fontSize: 13, color: 'var(--text-light)', marginBottom: 12, lineHeight: 1.5 }}>
                    {model.why}
                  </p>

                  {isPulling ? (
                    <div>
                      <div className="progress-bar">
                        <div className="progress-fill" style={{ width: `${pullState.progress}%` }} />
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
                        <span>{pullState.status} · {pullState.progress}%</span>
                        {pullState.eta && pullState.eta.remaining > 0 && (
                          <span>
                            {pullState.eta.remaining >= 60
                              ? `~${Math.ceil(pullState.eta.remaining / 60)} min left`
                              : `~${pullState.eta.remaining}s left`}
                            {pullState.eta.speed && ` · ${pullState.eta.speed} MB/s`}
                          </span>
                        )}
                      </div>
                    </div>
                  ) : installed ? (
                    <div className="flex gap-2">
                      <button className="btn btn-sm btn-primary" onClick={() => { selectModel(model.id); setPage('chat'); }}>
                        Chat →
                      </button>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(model.id)}>
                        Remove
                      </button>
                    </div>
                  ) : fitsHardware ? (
                    <button className="btn btn-sm btn-primary" onClick={() => handlePull(model.id)}>
                      Get Model
                    </button>
                  ) : (
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 8, lineHeight: 1.5 }}>
                        May be too large for your RAM — could be slow or crash. Try at your own risk.
                      </div>
                      <button
                        className="btn btn-sm"
                        onClick={() => handlePull(model.id)}
                        style={{ background: 'transparent', border: '1.5px solid rgba(93,78,55,0.3)', color: 'var(--text-light)' }}
                      >
                        Try anyway
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
