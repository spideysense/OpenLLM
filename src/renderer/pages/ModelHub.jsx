import React, { useState, useEffect } from 'react';
import { useApp } from '../App';

// Tool-capable defaults shown if the remote registry can't be fetched. Power-ranked.
const FALLBACK_MODELS = [
  { model: 'llama4:scout', name: 'Llama 4 Scout', provider: 'Meta', download_gb: 65, min_tier: 'ultra', why: "Meta's open flagship. Strong tool use, huge context." },
  { model: 'qwen3:32b', name: 'Qwen 3 32B', provider: 'Alibaba', download_gb: 20, min_tier: 'heavy', why: 'Most reliable tool-calling of any local model.' },
  { model: 'gemma4:26b', name: 'Gemma 4 26B', provider: 'Google', download_gb: 18, min_tier: 'heavy', why: 'Native function-calling trained in. Great all-round agent.' },
  { model: 'qwen2.5:32b', name: 'Qwen 2.5 32B', provider: 'Alibaba', download_gb: 20, min_tier: 'heavy', why: 'GPT-4-class with a mature tool ecosystem.' },
  { model: 'qwen3:14b', name: 'Qwen 3 14B', provider: 'Alibaba', download_gb: 10, min_tier: 'medium', why: 'Production tool reliability that fits 16 GB. The sweet spot.' },
  { model: 'gemma4:e4b', name: 'Gemma 4 E4B', provider: 'Google', download_gb: 9.6, min_tier: 'medium', why: 'Built-in tools + vision, edge-optimized.' },
  { model: 'qwen2.5:7b', name: 'Qwen 2.5 7B', provider: 'Alibaba', download_gb: 4.7, min_tier: 'medium', why: 'Beats larger models on benchmarks, solid tools.' },
  { model: 'llama3.1:8b', name: 'Llama 3.1 8B', provider: 'Meta', download_gb: 5, min_tier: 'light', why: 'Reliable lightweight pick. Fast, dependable tool calling.' },
  { model: 'llama3.2:3b', name: 'Llama 3.2 3B', provider: 'Meta', download_gb: 2.0, min_tier: 'light', why: 'Runs on anything. Tool-capable and fast.' },
];

// Rough RAM needed to run = model weights (~ download size) plus headroom for the
// context window / KV cache. Mirrors LM Studio's "estimated memory" on model cards.
const ramToRun = (gb) => Math.max(4, Math.ceil(gb + Math.max(2, gb * 0.25)));

// Light capability inference from the model's own description, for at-a-glance tags.
const tagsFor = (m) => {
  const s = `${m.name} ${m.why || ''}`.toLowerCase();
  const t = [];
  if (/tool|function|agent/.test(s)) t.push('tools');
  if (/vision|image|multimodal/.test(s)) t.push('vision');
  if (/cod(e|ing)/.test(s)) t.push('coding');
  return t;
};

export default function ModelHub() {
  const { bridge, models, refreshModels, hardwareTier, selectModel, setPage, activeModel } = useApp();
  // Per-model download state, keyed by model id, so multiple models can download
  // at once without clobbering each other. Each entry: { progress, status, eta }.
  const [pulls, setPulls] = useState({});
  const pullMetaRef = React.useRef({}); // per-model { startTime, lastPct } for ETA + monotonic smoothing
  const [catalog, setCatalog] = useState(FALLBACK_MODELS);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!bridge?.registry?.get) return;
    bridge.registry.get().then((reg) => {
      if (Array.isArray(reg?.models) && reg.models.length > 0) setCatalog(reg.models);
    }).catch(() => {});
  }, []);

  const installedNames = models.map((m) => m.name);

  useEffect(() => {
    if (!bridge) return;
    const unsub = bridge.models.onPullProgress((data) => {
      const id = data.model;
      if (!id) return;
      setPulls((prev) => {
        const cur = prev[id] || { progress: 0, status: '', eta: null };
        let pct = Number.isFinite(cur.progress) ? cur.progress : 0;
        if (data.total > 0 && typeof data.percent === 'number' && Number.isFinite(data.percent)) {
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
      const list = await refreshModels();
      const installed = Array.isArray(list)
        ? list.some((m) => m.name === modelId || m.name === modelId.split(':')[0])
        : true;
      if (installed) selectModel(modelId);
    } else {
      // Show error inline on the model card instead of a system alert
      setPulls((prev) => ({
        ...prev,
        [modelId]: { progress: 0, status: result.error || 'Download failed. Try again.', error: true },
      }));
      setTimeout(() => {
        setPulls((prev) => { const n = { ...prev }; delete n[modelId]; return n; });
        delete pullMetaRef.current[modelId];
      }, 5000);
      return; // skip the cleanup below — the timeout handles it
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
    // Exact match: "gemma4:e4b" only matches "gemma4:e4b", not "gemma4:12b".
    // Also match without tag for models where Ollama stores as "model:latest".
    const base = modelId.split(':')[0];
    return installedNames.some((n) => n === modelId || n === base || n === `${base}:latest`);
  }

  // True when this catalog id is the model currently loaded for chat. Uses the
  // same tag/base matching as isInstalled so "gemma4:26b" lights up whether the
  // active model is stored as "gemma4:26b" or "gemma4".
  function isActiveModel(modelId) {
    if (!activeModel) return false;
    const base = modelId.split(':')[0];
    return activeModel === modelId || activeModel === base || activeModel === `${base}:latest`;
  }
  // Is the active model present anywhere in the catalog? If not, the banner is
  // the only place the user can see it — so it must never depend on the grid.
  const activeInCatalog = !!activeModel && catalog.some((m) => isActiveModel(m.model));

  const tierOrder = { light: 0, medium: 1, heavy: 2, ultra: 3 };
  const userTierIdx = tierOrder[hardwareTier] ?? 1;

  function canRun(tier) {
    return (tierOrder[tier] ?? 0) <= userTierIdx;
  }

  return (
    <div className="page">
      <div className="page-title">Models</div>
      <div className="page-sub">
        Ranked most to least capable. Every model here works with Aspen's tools. Your machine: <strong>{hardwareTier}</strong> tier.
      </div>

      {activeModel && (
        <div className="active-model-banner">
          <span className="active-model-dot" />
          <span>
            Currently in use: <strong>{activeModel}</strong>
            {!activeInCatalog && <span className="active-model-note"> · installed outside this list</span>}
          </span>
          <button
            className="btn btn-sm"
            style={{ marginLeft: 'auto' }}
            onClick={() => setPage('chat')}
          >
            Open chat →
          </button>
        </div>
      )}

      {(() => {
        // The recommended model = the most capable one this machine can run
        // (catalog is already power-ranked, so it's the first that fits).
        const recommendedId = catalog.find((m) => canRun(m.min_tier))?.model || null;
        const q = query.trim().toLowerCase();
        const filtered = q
          ? catalog.filter((m) => `${m.name} ${m.provider} ${m.why || ''}`.toLowerCase().includes(q))
          : catalog;
        return (
          <>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search models…"
            style={{ width: '100%', padding: '10px 14px', marginBottom: 16, borderRadius: 10, border: '1.5px solid var(--border, rgba(0,0,0,.1))', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
          />
          <div className="model-grid">
            {filtered.map((model) => {
              const id = model.model;
              const installed = isInstalled(id);
              const active = isActiveModel(id);
              const pullState = pulls[id];
              const isPulling = !!pullState;
              const fitsHardware = canRun(model.min_tier);
              const isRecommended = id === recommendedId;

              return (
                <div
                  key={id}
                  className={`model-card ${isRecommended ? 'recommended' : ''} ${active ? 'active' : ''}`}
                  style={{ opacity: fitsHardware ? 1 : 0.55 }}
                >
                  <div className="model-card-header">
                    <div>
                      <h3>{model.name}</h3>
                      <div className="model-meta">{model.provider} · {model.download_gb} GB · needs ~{ramToRun(model.download_gb)} GB RAM</div>
                      {tagsFor(model).length > 0 && (
                        <div style={{ display: 'flex', gap: 5, marginTop: 6 }}>
                          {tagsFor(model).map((t) => (
                            <span key={t} style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--text-light)', background: 'rgba(0,0,0,0.05)', borderRadius: 5, padding: '2px 6px' }}>{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    {installed && active && (
                      <span className="badge badge-green"><span className="active-model-dot" /> In use</span>
                    )}
                    {installed && !active && <span className="badge badge-green">Installed</span>}
                    {!installed && isRecommended && !isPulling && (
                      <span className="badge badge-yellow">★ Recommended</span>
                    )}
                    {!fitsHardware && !installed && !isRecommended && (
                      <span className="badge" style={{ background: 'rgba(0,0,0,0.06)', color: 'var(--text-light)' }}>
                        Too big
                      </span>
                    )}
                  </div>

                  <p style={{ fontSize: 13, color: 'var(--text-light)', marginBottom: 12, lineHeight: 1.5 }}>
                    {model.why}
                  </p>

                  <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 10, color: fitsHardware ? 'var(--green, #1A7A4A)' : 'var(--text-light)' }}>
                    {fitsHardware ? '✓ Runs on your machine' : `Needs a bigger machine (${model.min_tier} tier)`}
                  </div>

                  {isPulling ? (
                    <div>
                      <div className="progress-bar">
                        <div className="progress-fill" style={{ width: `${pullState.progress}%` }} />
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
                        <span>{pullState.status}{Number.isFinite(pullState.progress) && pullState.progress > 0 ? ` · ${pullState.progress}%` : ''}</span>
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
                      <button className="btn btn-sm btn-primary" onClick={() => { selectModel(id); setPage('chat'); }}>
                        Chat →
                      </button>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(id)}>
                        Remove
                      </button>
                    </div>
                  ) : fitsHardware ? (
                    <button className="btn btn-sm btn-primary" onClick={() => handlePull(id)}>
                      Get Model
                    </button>
                  ) : (
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 8, lineHeight: 1.5 }}>
                        May be too large for your RAM — could be slow or crash. Try at your own risk.
                      </div>
                      <button
                        className="btn btn-sm"
                        onClick={() => handlePull(id)}
                        style={{ background: 'transparent', border: '1.5px solid rgba(0,0,0,0.3)', color: 'var(--text-light)' }}
                      >
                        Try anyway
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          </>
        );
      })()}
    </div>
  );
}
