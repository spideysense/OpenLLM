import { it, expect, vi, afterEach } from 'vitest';
import tts from '../../src/renderer/lib/tts';
afterEach(() => { tts.stop(); vi.unstubAllGlobals(); });
it('selects only on-device voices and resolves pending playback when stopped', async () => {
  let utterance;
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(text) { this.text = text; } });
  const local = { name: 'Local', lang: 'en-US', localService: true }, remote = { name: 'Remote', lang: 'en-US', default: true, localService: false };
  vi.stubGlobal('speechSynthesis', { getVoices: () => [remote, local], cancel: vi.fn(), speak: value => { utterance = value; } });
  const speaking = tts.speak('Private household text'); await Promise.resolve();
  expect(utterance.voice).toBe(local); tts.stop(); await speaking;
  expect(window.speechSynthesis.cancel).toHaveBeenCalled();
});
