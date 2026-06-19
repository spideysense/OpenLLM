// One send path for both tiers. Mirrors the existing streamChat() callback
// shape (onStatus/onDelta/onError/onDone/signal) so ChatScreen doesn't branch.
//
//   mode 'local' -> on-device llama.rn (instant, offline, private)
//   mode 'box'   -> phone -> Vercel -> your Aspen box (the big models)

import { streamChat } from './api';
import { loadModel, localChat } from './engine/localEngine';

export async function sendMessage({
  mode,
  config,            // { tunnelUrl, apiKey } — box mode only
  boxModel,          // string — box mode only (server still auto-routes)
  localFile,         // gguf filename — local mode only
  messages,
  onStatus,
  onDelta,
  onError,
  onDone,
  signal,
}) {
  if (mode === 'box') {
    return streamChat({
      tunnelUrl: config.tunnelUrl,
      apiKey: config.apiKey,
      model: boxModel,
      messages,
      onStatus, onDelta, onError, onDone, signal,
    });
  }

  // Local (on-device)
  try {
    onStatus?.('Loading model…', true);          // transient; clears on first token
    await loadModel(localFile);
    await localChat({ messages, onToken: (t) => onDelta?.(t), signal });
    onDone?.();
  } catch (e) {
    if (e?.name === 'AbortError') { onDone?.(); return; }
    onError?.(e?.message || 'On-device model error');
  }
}
