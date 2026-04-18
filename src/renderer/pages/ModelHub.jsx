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
  const [pulling, setPulling] = useState(null);
  const [pullProgress, setPullProgress] = useState(0);
  const [pullStatus, setPullStatus] = useState('');
  const [pullEta, setPullEta] = useState(null);
  const pullStartRef = React.useRef(null);
  const lastBytesRef = React.useRef(0);

  const installedNames = models.map((m) => m.name);

  useEffect(() => {
    if (!bridge) return;
    const unsub = bridge.models.onPullProgress((data) => {
      setPullStatus(data.status);
      if (data.total > 0) {
        const pct = data.percent;
        setPullProgress(pct);

        // ETA calculation
        const now = Date.now();
        if (!pullStartRef.current) pullStartRef.current = now;
        const elapsed = (now - pullStartRef.current) / 1000; // seconds
        if (elapsed > 2 && pct > 1) {
          const totalEstSec = elapsed / (pct / 100);
          const remaining = Math.max(0, totalEstSec - elapsed);
          const speed = data.completed ? (data.completed / 1e6 / elapsed).toFixed(1) : null;
          setPullEta({ remaining: Math.round(remaining), speed });
        }
      }
    });
    return unsub;
  }, [bridge]);

  async function handlePull(modelId) {
    if (!bridge) return;
    setPulling(modelId);
    setPullProgress(0);
    setPullStatus('Starting...');
    setPullEta(null);
    pullStartRef.current = null;
    lastBytesRef.current = 0;

    await bridge.ollama.ensureRunning();
    const result = await bridge.models.pull(modelId);

    if (result.success) {
      await refreshModels();
      selectModel(modelId);
    }

    setPulling(null);
    setPullProgress(0);
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
        The bear picked these for you. Your machine: <strong>{hardwareTier}</strong> tier.
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
              const isPulling = pulling === model.id;
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
                        <div className="progress-fill" style={{ width: `${pullProgress}%` }} />
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
                        <span>{pullStatus} · {pullProgress}%</span>
                        {pullEta && pullEta.remaining > 0 && (
                          <span>
                            {pullEta.remaining >= 60
                              ? `~${Math.ceil(pullEta.remaining / 60)} min left`
                              : `~${pullEta.remaining}s left`}
                            {pullEta.speed && ` · ${pullEta.speed} MB/s`}
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
                  ) : (
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => handlePull(model.id)}
                      disabled={!fitsHardware}
                    >
                      {fitsHardware ? 'Get Model' : 'Too large for your machine'}
                    </button>
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
