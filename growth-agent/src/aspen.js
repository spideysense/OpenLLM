// Thin client to the Aspen gateway (OpenAI-compatible). This is where the free
// 24/7 inference comes from — every "thinking" step in the agent runs on the box.
import { cfg } from './config.js';
import { warn } from './log.js';

export async function chat(messages, { json = false, temperature = 0.4, maxTokens = 1200 } = {}) {
  const res = await fetch(`${cfg.aspen.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.aspen.apiKey}` },
    body: JSON.stringify({
      model: cfg.aspen.model,
      messages,
      temperature,
      max_tokens: maxTokens,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Aspen gateway ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = (data.choices?.[0]?.message?.content || '').trim();
  if (!json) return text;
  try {
    return JSON.parse(text.replace(/^```json\s*|\s*```$/g, ''));
  } catch (e) {
    warn('Aspen JSON parse failed, returning raw'); return { _raw: text };
  }
}

// Ask the model for strict JSON with a schema hint. Used by the agent steps.
export function askJSON(system, user) {
  return chat(
    [{ role: 'system', content: system + '\nRespond with ONLY valid JSON, no prose, no code fences.' },
     { role: 'user', content: user }],
    { json: true, temperature: 0.3 },
  );
}
