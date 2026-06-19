// On-device inference via llama.rn (llama.cpp + Metal). Verified against
// llama.rn 0.12.x: initLlama({model,n_ctx,n_gpu_layers,n_threads}) -> context;
// context.completion({messages,n_predict,stop}, onData) -> {text,timings};
// context.stopCompletion(); context.release().
//
// The model context is EXPENSIVE to create — load once, keep resident, reuse
// across turns. That residency is what makes follow-up messages instant.

import { initLlama } from 'llama.rn';
import RNFS from 'react-native-fs';

let ctx = null;
let loadedPath = null;

// Keep the same "no code unless asked / be concise" guard the gateway uses, so a
// 1B model doesn't dump HTML on "hello".
export const LOCAL_SYSTEM_PROMPT =
  'You are Aspen, a private AI running 100% on this iPhone. Nothing leaves the ' +
  'device. Be concise — lead with the answer, no preamble. NEVER write code or ' +
  'HTML unless the user explicitly asks you to build, write, or fix something ' +
  'technical. Personal or casual messages get a warm, plain reply, never code.';

const STOP = [
  '</s>', '<|end|>', '<|eot_id|>', '<|end_of_text|>',
  '<|im_end|>', '<|EOT|>', '<|end_of_turn|>', '<|endoftext|>',
];

export function modelPath(file) {
  return `${RNFS.DocumentDirectoryPath}/${file}`;
}

export function isModelDownloaded(file) {
  return RNFS.exists(modelPath(file));
}

// Resumable download with progress (0..1). Returns the local path on success.
// The returned object also has .cancel() if you wire a cancel button.
export function downloadModel(url, file, onProgress) {
  const toFile = modelPath(file);
  const { jobId, promise } = RNFS.downloadFile({
    fromUrl: url,
    toFile,
    background: true,                 // keep downloading if app backgrounds (iOS)
    discretionary: false,
    progressInterval: 200,
    progress: (r) => {
      if (r.contentLength > 0) onProgress?.(r.bytesWritten / r.contentLength);
    },
  });
  const wrapped = promise.then((res) => {
    if (res.statusCode && res.statusCode >= 400) {
      throw new Error(`Download failed (${res.statusCode})`);
    }
    return toFile;
  });
  wrapped.cancel = () => RNFS.stopDownload(jobId);
  return wrapped;
}

export async function loadModel(file) {
  const path = modelPath(file);
  if (ctx && loadedPath === path) return;          // already resident
  if (ctx) { try { await ctx.release(); } catch {} ctx = null; loadedPath = null; }
  ctx = await initLlama({
    model: path,
    use_mlock: true,        // lock weights in RAM, no swap
    n_ctx: 4096,
    n_threads: 4,
    n_gpu_layers: 99,       // offload all layers to Metal — this is the "instant"
  });
  loadedPath = path;
}

// Streaming chat. Calls onToken(text) per token. Honors an AbortSignal by
// stopping native generation. Returns the full text.
export async function localChat({ messages, onToken, signal }) {
  if (!ctx) throw new Error('Model not loaded');
  const withSystem = messages.some((m) => m.role === 'system')
    ? messages
    : [{ role: 'system', content: LOCAL_SYSTEM_PROMPT }, ...messages];

  let stopped = false;
  const onAbort = () => { stopped = true; try { ctx.stopCompletion(); } catch {} };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    const res = await ctx.completion(
      { messages: withSystem, n_predict: 1024, temperature: 0.7, stop: STOP },
      (data) => { if (!stopped && data?.token) onToken?.(data.token); },
    );
    return res?.text || '';
  } finally {
    if (signal) signal.removeEventListener?.('abort', onAbort);
  }
}

export async function unloadModel() {
  if (ctx) { try { await ctx.release(); } catch {} ctx = null; loadedPath = null; }
}
