// Aspen network client — mirrors the proven web-app contract so it works against
// the same backend with no server changes:
//   • connect:  GET  {tunnelUrl}/v1/models  (Bearer apiKey)   — validates the box
//   • chat:     POST https://www.runonaspen.com/api/agent  with
//               { tunnelUrl, apiKey, model, messages }       — streams SSE back
//   • SSE events:
//       data: {"choices":[{"delta":{"content":"…"}}]}   → answer tokens
//       data: {"aspen_status":"Searching the web…","aspen_transient":bool} → activity
//       data: {"error":"…"}                              → upstream error
//       data: [DONE]                                     → end
//
// Streaming requires Expo SDK 52+ (`expo/fetch` exposes a WHATWG ReadableStream
// body). Validation uses the standard global fetch (no streaming needed).
import { fetch as streamFetch } from 'expo/fetch';

const PROXY = 'https://www.runonaspen.com';

export function normalizeUrl(u) {
  return (u || '').trim().replace(/\/+$/, '').replace(/\/v1$/, '');
}

// Validate a box and return its available model ids.
export async function fetchModels(tunnelUrl, apiKey) {
  const url = normalizeUrl(tunnelUrl);
  if (!url) throw new Error('No address');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${url}/v1/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    return (data?.data || []).map((m) => m.id).filter(Boolean);
  } finally {
    clearTimeout(timer);
  }
}

// Stream a chat turn. Calls callbacks as data arrives.
export async function streamChat({
  tunnelUrl,
  apiKey,
  model,
  messages,
  onStatus,
  onDelta,
  onError,
  onDone,
  signal,
}) {
  try {
    const res = await streamFetch(`${PROXY}/api/agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tunnelUrl: normalizeUrl(tunnelUrl),
        apiKey: apiKey || '',
        model,
        messages,
      }),
      signal,
    });

    if (!res.ok || !res.body) {
      let msg = `Request failed (${res.status})`;
      try {
        const j = await res.json();
        if (j?.error) msg = j.error;
      } catch {}
      onError?.(msg);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data: ')) continue;
        const d = t.slice(6);
        if (d === '[DONE]') continue;
        try {
          const j = JSON.parse(d);
          if (j.error) {
            onError?.(j.error);
            return;
          }
          if (j.aspen_status || j.aspen_tool) {
            if (j.aspen_status) onStatus?.(j.aspen_status, !!j.aspen_transient);
            continue;
          }
          const delta = j.choices?.[0]?.delta?.content;
          if (delta) onDelta?.(delta);
        } catch {
          // partial / non-JSON keep-alive line — ignore
        }
      }
    }
    onDone?.();
  } catch (e) {
    if (e?.name === 'AbortError') {
      onDone?.();
      return;
    }
    onError?.(e?.message || 'Network error');
  }
}
