/** Local operating-system speech only. No runtime JavaScript from a CDN. */
let current = null;
let generation = 0;
let onReady = null;
let onError = null;
const synth = () => (typeof window !== 'undefined' ? window.speechSynthesis : null);
function voices() {
  return (
    synth()
      ?.getVoices()
      .filter((v) => v.localService === true) || []
  );
}
export function setCallbacks(callbacks = {}) {
  onReady = callbacks.onReady;
  onError = callbacks.onError;
}
async function localVoice() {
  const engine = synth();
  if (!engine) throw new Error('Local speech is unavailable on this device.');
  if (!voices().length)
    await new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        engine.removeEventListener('voiceschanged', finish);
        resolve();
      };
      const timer = setTimeout(finish, 2000);
      engine.addEventListener('voiceschanged', finish);
    });
  const available = voices();
  const preferred = typeof navigator !== 'undefined' ? navigator.language?.split('-')[0] : 'en';
  const voice =
    available.find((v) => v.lang.startsWith(preferred) && v.default) ||
    available.find((v) => v.lang.startsWith(preferred)) ||
    available[0];
  if (!voice)
    throw new Error(
      'Install a local voice in your operating system’s speech settings to use read-aloud.'
    );
  return voice;
}
export async function speak(text) {
  if (!text?.trim()) return;
  stop();
  const request = generation;
  try {
    const voice = await localVoice();
    if (request !== generation) return;
    return await new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text.trim());
      utterance.voice = voice;
      utterance.lang = voice.lang;
      const finish = () => {
        if (current?.utterance === utterance) current = null;
        resolve();
      };
      utterance.onend = finish;
      utterance.onerror = finish;
      current = { utterance, finish };
      synth().speak(utterance);
    });
  } catch (error) {
    onError?.(error.message);
    if (typeof window !== 'undefined')
      window.dispatchEvent(new CustomEvent('aspen:error', { detail: error.message }));
  }
}
export function stop() {
  generation++;
  synth()?.cancel();
  current?.finish();
  current = null;
}
export function isReady() {
  return voices().length > 0;
}
export function preload() {
  localVoice()
    .then(() => onReady?.())
    .catch(() => {});
}
export function splitIntoSentences(text) {
  return text
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);
}
export default { speak, stop, isReady, preload, splitIntoSentences, setCallbacks };
