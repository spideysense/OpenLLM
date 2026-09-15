// Aspen network client — mirrors the proven web-app contract so it works against
// the same backend with no server changes:
//   Paired requests and responses use the authenticated encrypted channel to the box.
//   • SSE events:
//       data: {"choices":[{"delta":{"content":"…"}}]}   → answer tokens
//       data: {"aspen_status":"Searching the web…","aspen_transient":bool} → activity
//       data: {"error":"…"}                              → upstream error
//       data: [DONE]                                     → end
//
// Streaming requires Expo SDK 52+ (`expo/fetch` exposes a WHATWG ReadableStream
// body). Validation uses the standard global fetch (no streaming needed).
import { fetch as streamFetch } from 'expo/fetch';
import { secureFetch } from './secure-fetch';
import { nativeCrypto } from './secure-crypto';

const PROXY = 'https://www.runonaspen.com';
export async function enroll(tunnelUrl, apiKey, body) {
  const response = await secureFetch(normalizeUrl(tunnelUrl), apiKey, '/v1/enroll', { method: 'POST', body, fetchImpl: streamFetch, cryptoAdapter: nativeCrypto });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Setup failed');
  return value;
}
export async function confirmEnrollment(tunnelUrl, authorizer, pending) {
  try { return await enroll(tunnelUrl, authorizer, { action: 'confirm', id: pending.id }); }
  catch (error) {
    const check = await secureFetch(normalizeUrl(tunnelUrl), pending.credential, '/v1/vault', { fetchImpl: streamFetch, cryptoAdapter: nativeCrypto });
    if (!check.ok) throw error;
    return { success: true };
  }
}

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
    const res = await secureFetch(url, apiKey, '/v1/models', { signal: ctrl.signal, fetchImpl: streamFetch, cryptoAdapter: nativeCrypto });
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
    const res = await secureFetch(normalizeUrl(tunnelUrl), apiKey, '/v1/agent', { method: 'POST', body: { model, messages }, signal, fetchImpl: streamFetch, cryptoAdapter: nativeCrypto });

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
