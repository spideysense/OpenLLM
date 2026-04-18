import React, { useState, useEffect } from 'react';
import { useApp } from '../App';

const STEPS = ['welcome', 'detect', 'recommend', 'download', 'ready'];

export default function Onboarding() {
  const { bridge, systemInfo, hardwareTier, completeOnboarding, selectModel, refreshModels } = useApp();
  const [step, setStep] = useState(0);
  const [recommendation, setRecommendation] = useState(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadStatus, setDownloadStatus] = useState('');
  const [error, setError] = useState(null);

  const currentStep = STEPS[step];

  // Get recommendation on detect step
  useEffect(() => {
    if (currentStep === 'detect' && bridge) {
      bridge.models.recommend().then(setRecommendation);
    }
  }, [currentStep, bridge]);

  // Listen to download progress
  useEffect(() => {
    if (!bridge) return;
    const unsub = bridge.models.onPullProgress((data) => {
      setDownloadStatus(data.status);
      if (data.total > 0) {
        setDownloadProgress(data.percent);
      }
    });
    return unsub;
  }, [bridge]);

  // Listen to Ollama install/startup progress
  useEffect(() => {
    if (!bridge) return;
    const unsub = bridge.ollama.onProgress((msg) => {
      setDownloadStatus(msg);
    });
    return unsub;
  }, [bridge]);

  async function handleDownload() {
    if (!recommendation || !bridge) return;
    setStep(3); // download step
    setError(null);

    try {
      // Start the AI engine (bundled, automatic)
      setDownloadStatus('Starting AI engine...');
      const runResult = await bridge.ollama.ensureRunning();
      if (!runResult.success) {
        setError(runResult.message || 'Could not start the AI engine. Please restart Monet.');
        return;
      }

      // Pull the model
      setDownloadStatus(`Downloading ${recommendation.name || recommendation.model}...`);
      const result = await bridge.models.pull(recommendation.model);
      if (result.success) {
        await selectModel(recommendation.model);
        setStep(4); // ready
      } else {
        setError(result.error || 'Download failed. Check your internet connection and try again.');
      }
    } catch (e) {
      setError(e.message || 'Something went wrong. Please restart Monet and try again.');
    }
  }

  const bearStates = {
    welcome: '🎨',
    detect: '🔍',
    recommend: '⭐',
    download: '📦',
    ready: '🎉',
  };

  return (
    <div className="onboarding">
      {/* Step dots */}
      <div className="onboarding-steps">
        {STEPS.map((s, i) => (
          <div key={s} className={`onboarding-dot ${i === step ? 'active' : ''}`} />
        ))}
      </div>

      {/* ── Welcome ── */}
      {currentStep === 'welcome' && (
        <>
          <div className="onboarding-bear">{bearStates.welcome}</div>
          <h1>Hi! I'm Monet.</h1>
          <p>
            I run AI right on your computer. No subscriptions, no data sharing, no nonsense.
            Let's get you set up in about 2 minutes.
          </p>
          <button className="btn btn-primary" onClick={() => setStep(1)}>
            Let's Go →
          </button>
        </>
      )}

      {/* ── Detect Hardware ── */}
      {currentStep === 'detect' && (
        <>
          <div className="onboarding-bear">🔍</div>
          <h1>Checking Your Machine</h1>
          <p>Let me see what you're working with...</p>

          <div className="hw-card">
            {systemInfo ? (
              <>
                <div className="hw-row"><span className="check">✓</span> {systemInfo.machineName}</div>
                <div className="hw-row"><span className="check">✓</span> {systemInfo.totalRAMGB} GB RAM</div>
                <div className="hw-row"><span className="check">✓</span> {systemInfo.gpu.name}</div>
                <div className="hw-row"><span className="check">✓</span> Tier: {hardwareTier.charAt(0).toUpperCase() + hardwareTier.slice(1)}</div>
              </>
            ) : (
              <>
                <div className="hw-row"><span className="check">✓</span> Detecting hardware...</div>
              </>
            )}
          </div>

          <button className="btn btn-primary" onClick={() => setStep(2)}>
            Continue →
          </button>
        </>
      )}

      {/* ── Recommend Model ── */}
      {currentStep === 'recommend' && (
        <>
          <div className="onboarding-bear">⭐</div>
          <h1>I Recommend This One</h1>
          <p>Based on your machine, this is the best model for you:</p>

          {recommendation && (
            <div className="model-rec">
              <h3>★ {recommendation.name || recommendation.model}</h3>
              <p>{recommendation.why || 'Great for everyday use'}</p>
              <p style={{ marginTop: 8, fontSize: 13, color: 'var(--text-light)' }}>
                {recommendation.sizeGB || '~4'} GB download
              </p>
            </div>
          )}

          <div className="flex gap-3">
            <button className="btn btn-primary" onClick={handleDownload}>
              Download & Start →
            </button>
            <button className="btn btn-secondary" onClick={() => completeOnboarding()}>
              Skip for now
            </button>
          </div>
        </>
      )}

      {/* ── Downloading ── */}
      {currentStep === 'download' && (
        <>
          <div className="onboarding-bear" style={{ animation: 'none', fontSize: 60 }}>
            {downloadProgress < 100 ? '⏳' : '📦'}
          </div>
          <h1>Getting Your Model Ready</h1>
          <p>{downloadStatus || 'Starting download...'}</p>

          <div style={{ width: '100%', maxWidth: 400, marginBottom: 24 }}>
            <div className="progress-bar" style={{ height: 12 }}>
              <div className="progress-fill" style={{ width: `${downloadProgress}%` }} />
            </div>
            <div style={{ textAlign: 'center', marginTop: 8, fontSize: 14, color: 'var(--text-light)' }}>
              {downloadProgress}%
            </div>
          </div>

          {error && (
            <div style={{ color: 'var(--danger)', marginBottom: 16, fontSize: 14 }}>
              {error}
              <br />
              <button className="btn btn-sm btn-secondary mt-2" onClick={handleDownload}>
                Try Again
              </button>
            </div>
          )}
        </>
      )}

      {/* ── Ready ── */}
      {currentStep === 'ready' && (
        <>
          <div className="onboarding-bear">🎉</div>
          <h1>Your AI is Running!</h1>
          <p>
            Everything is 100% local. Your data never leaves this machine.
            Zero subscriptions. Zero data sharing. Everything local.
          </p>

          <div className="flex gap-3">
            <button className="btn btn-primary" onClick={completeOnboarding}>
              Start Chatting 🎨
            </button>
          </div>
        </>
      )}
    </div>
  );
}
