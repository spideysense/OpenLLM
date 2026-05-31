/**
 * Aspen TTS — Piper WASM via @mintplex-labs/piper-tts-web
 *
 * Loads via CDN, downloads voice model once (~60MB), caches in browser.
 * Runs in a Web Worker so synthesis never blocks the UI.
 *
 * Usage:
 *   import tts from './lib/tts';
 *   await tts.speak("Hello!"); // speaks text, returns when done
 *   tts.stop();                // interrupts current speech
 */

const CDN = 'https://cdn.jsdelivr.net/npm/@mintplex-labs/piper-tts-web@1.0.4/dist/';
const VOICE_ID = 'en_US-hfc_female-medium';

let ttsInstance = null;
let loading = false;
let loadCallbacks = [];
let currentAudio = null;
let downloadProgress = null;

// Callbacks for UI updates
let onDownloadProgress = null;
let onReady = null;

export function setCallbacks({ onProgress, onReady: ready }) {
  onDownloadProgress = onProgress;
  onReady = ready;
}

async function getInstance() {
  if (ttsInstance) return ttsInstance;

  if (loading) {
    return new Promise((resolve) => loadCallbacks.push(resolve));
  }

  loading = true;

  try {
    // Dynamically import from CDN
    const { PiperTTSSession } = await import(/* @vite-ignore */ CDN + 'index.js');

    const session = new PiperTTSSession({
      wasmPath: CDN + 'piper_phonemize.js',
      onnxWasmPath: CDN,
    });

    // Download voice model (cached after first time)
    const stored = await session.stored();
    if (!stored.includes(VOICE_ID)) {
      await session.download(VOICE_ID, (progress) => {
        const pct = Math.round((progress.loaded / progress.total) * 100);
        onDownloadProgress?.(pct);
      });
    }

    ttsInstance = session;
    onReady?.();
    loadCallbacks.forEach(cb => cb(session));
    loadCallbacks = [];
    return session;
  } catch (err) {
    loading = false;
    loadCallbacks = [];
    throw err;
  }
}

export async function speak(text) {
  if (!text?.trim()) return;

  try {
    const session = await getInstance();
    const wav = await session.predict({ text: text.trim(), voiceId: VOICE_ID });

    // Stop any currently playing audio
    stop();

    const audio = new Audio();
    audio.src = URL.createObjectURL(wav);
    currentAudio = audio;

    return new Promise((resolve) => {
      audio.onended = () => {
        URL.revokeObjectURL(audio.src);
        if (currentAudio === audio) currentAudio = null;
        resolve();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(audio.src);
        if (currentAudio === audio) currentAudio = null;
        resolve();
      };
      audio.play().catch(resolve);
    });
  } catch (err) {
    console.error('[TTS] speak error:', err);
  }
}

export function stop() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    try { URL.revokeObjectURL(currentAudio.src); } catch {}
    currentAudio = null;
  }
}

export function isReady() {
  return ttsInstance !== null;
}

// Pre-warm: start loading in background immediately
export function preload() {
  getInstance().catch(() => {});
}

// Split text into speakable sentences
export function splitIntoSentences(text) {
  return text
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 2);
}

export default { speak, stop, isReady, preload, splitIntoSentences, setCallbacks };
