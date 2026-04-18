import React, { useState, useEffect } from 'react';
import { useApp } from '../App';

const SERVICES = [
  { id: 'openai', name: 'OpenAI (ChatGPT)', aliases: ['gpt-4', 'gpt-4o', 'gpt-3.5-turbo'] },
  { id: 'anthropic', name: 'Anthropic (Claude)', aliases: ['claude-3-opus', 'claude-3.5-sonnet', 'claude-3-haiku'] },
  { id: 'google', name: 'Google (Gemini)', aliases: ['gemini-pro', 'gemini-1.5-pro'] },
  { id: 'reasoning', name: 'OpenAI Reasoning (o1)', aliases: ['o1', 'o1-mini', 'o3-mini'] },
];

export default function ReplaceWizard() {
  const { bridge, models, gatewayStatus } = useApp();
  const [step, setStep] = useState(0);
  const [selectedService, setSelectedService] = useState(null);
  const [aliasMap, setAliasMap] = useState({});
  const [apiKey, setApiKey] = useState(null);
  const [copied, setCopied] = useState(null);

  const installedModels = models.map((m) => m.name);

  // Load defaults
  useEffect(() => {
    if (bridge) {
      bridge.aliases.getDefaults().then((defaults) => {
        setAliasMap(defaults);
      });
    }
  }, [bridge]);

  // Generate API key on step 2
  useEffect(() => {
    if (step === 2 && !apiKey && bridge) {
      bridge.apikeys.create('Replace Wizard').then(setApiKey);
    }
  }, [step, apiKey, bridge]);

  function copyToClipboard(text, id) {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  const port = gatewayStatus?.port || 4000;
  const baseUrl = `http://localhost:${port}/v1`;
  const key = apiKey?.secret || 'sk-monet-xxxxx';
  const service = SERVICES.find((s) => s.id === selectedService);

  return (
    <div className="page">
      <div className="page-title">🔌 Replace Your AI Service</div>
      <div className="page-sub">
        Drop Monet into your existing code. Change two lines and everything works.
      </div>

      {/* ── Step 0: Pick service ── */}
      {step === 0 && (
        <div>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--earth)', marginBottom: 16 }}>
            What are you replacing?
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {SERVICES.map((svc) => (
              <button
                key={svc.id}
                onClick={() => { setSelectedService(svc.id); setStep(1); }}
                className="card"
                style={{
                  cursor: 'pointer',
                  textAlign: 'left',
                  border: selectedService === svc.id ? '2px solid var(--pipe-yellow)' : undefined,
                }}
              >
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--earth)', fontSize: 16 }}>
                  {svc.name}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-light)', marginTop: 4 }}>
                  {svc.aliases.join(', ')}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Step 1: Map aliases ── */}
      {step === 1 && service && (
        <div>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--earth)', marginBottom: 16 }}>
            Pick your local models
          </h3>
          <p style={{ fontSize: 14, color: 'var(--text-light)', marginBottom: 20, lineHeight: 1.6 }}>
            When apps ask for a {service.name} model, the bear will answer instead.
            {installedModels.length === 0 && (
              <span style={{ color: 'var(--danger)' }}> You need to install at least one model first.</span>
            )}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
            {service.aliases.map((alias) => (
              <div key={alias} className="card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--text-dark)',
                  minWidth: 160,
                }}>
                  {alias}
                </div>
                <span style={{ color: 'var(--pipe-yellow)', fontSize: 18 }}>→</span>
                <select
                  value={aliasMap[alias] || ''}
                  onChange={(e) => setAliasMap((prev) => ({ ...prev, [alias]: e.target.value }))}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1.5px solid rgba(93,78,55,0.12)',
                    fontFamily: 'var(--font-body)',
                    fontSize: 13,
                    background: 'var(--cloud)',
                  }}
                >
                  <option value="">-- select model --</option>
                  {installedModels.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="flex gap-3">
            <button className="btn btn-secondary" onClick={() => setStep(0)}>← Back</button>
            <button
              className="btn btn-primary"
              onClick={async () => {
                // Save aliases
                if (bridge) {
                  for (const [alias, model] of Object.entries(aliasMap)) {
                    if (model) await bridge.aliases.set(alias, model);
                  }
                }
                setStep(2);
              }}
            >
              Continue →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Copy credentials + code ── */}
      {step === 2 && (
        <div>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--earth)', marginBottom: 16 }}>
            Your AI Credentials
          </h3>

          {/* Credential cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-light)', marginBottom: 6 }}>Base URL</div>
              <div className="flex items-center gap-2">
                <code style={{
                  fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--earth)',
                  flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {baseUrl}
                </code>
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => copyToClipboard(baseUrl, 'url')}
                >
                  {copied === 'url' ? '✓' : 'Copy'}
                </button>
              </div>
            </div>
            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-light)', marginBottom: 6 }}>API Key 🔑</div>
              <div className="flex items-center gap-2">
                <code style={{
                  fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--earth)',
                  flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {key}
                </code>
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => copyToClipboard(key, 'key')}
                >
                  {copied === 'key' ? '✓' : 'Copy'}
                </button>
              </div>
            </div>
          </div>

          {/* Code snippets */}
          <h4 style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--earth)', marginBottom: 12 }}>
            Paste into your code:
          </h4>

          <CodeSnippet
            title="Python (OpenAI SDK)"
            code={`from openai import OpenAI

client = OpenAI(
    base_url="${baseUrl}",  # ← Monet
    api_key="${key}"        # ← Your key
)

response = client.chat.completions.create(
    model="gpt-4",  # the bear answers instead
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)`}
            onCopy={copyToClipboard}
            copied={copied}
          />

          <CodeSnippet
            title="JavaScript / Node.js"
            code={`import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: '${baseUrl}',  // ← Monet
  apiKey: '${key}'        // ← Your key
});

const response = await client.chat.completions.create({
  model: 'gpt-4',  // the bear answers instead
  messages: [{ role: 'user', content: 'Hello!' }]
});
console.log(response.choices[0].message.content);`}
            onCopy={copyToClipboard}
            copied={copied}
          />

          <CodeSnippet
            title="cURL"
            code={`curl ${baseUrl}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${key}" \\
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`}
            onCopy={copyToClipboard}
            copied={copied}
          />

          <CodeSnippet
            title="Cursor / Continue.dev"
            code={`Settings → Model → Custom / OpenAI-compatible

Base URL: ${baseUrl}
API Key:  ${key}
Model:    gpt-4`}
            onCopy={copyToClipboard}
            copied={copied}
          />

          <div className="flex gap-3 mt-4">
            <button className="btn btn-secondary" onClick={() => setStep(1)}>← Back</button>
            <button className="btn btn-primary" onClick={() => setStep(0)}>Done ✓</button>
          </div>
        </div>
      )}
    </div>
  );
}

function CodeSnippet({ title, code, onCopy, copied }) {
  const id = title.toLowerCase().replace(/\s/g, '-');
  return (
    <div className="code-block" style={{ marginBottom: 16 }}>
      <div className="code-block-header">
        <span>{title}</span>
        <button
          onClick={() => onCopy(code, id)}
          style={{
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: copied === id ? 'var(--grass-light)' : 'rgba(255,255,255,0.5)',
            padding: '4px 12px',
            borderRadius: 'var(--radius-pill)',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {copied === id ? '✓ Copied!' : 'Copy'}
        </button>
      </div>
      <pre>{code}</pre>
    </div>
  );
}
