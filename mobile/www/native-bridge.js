/**
 * Aspen Native Bridge
 * When running inside Capacitor, replaces browser speech APIs with native
 * iOS/Android plugins for reliable STT + high-quality TTS.
 * On web, this is a no-op — the existing browser code runs unchanged.
 */
(function () {
  const Cap = window.Capacitor;
  if (!Cap || !Cap.isNativePlatform || !Cap.isNativePlatform()) {
    window.AspenNative = { available: false };
    return;
  }

  const SpeechRecognition = Cap.Plugins.SpeechRecognition;
  const TextToSpeech = Cap.Plugins.TextToSpeech;

  let listening = false;

  const AspenNative = {
    available: true,

    async requestPermissions() {
      try {
        await SpeechRecognition.requestPermissions();
        return true;
      } catch (e) {
        console.error('[Native] permission error', e);
        return false;
      }
    },

    // Native STT — returns final transcript via callback
    async startListening(onResult, onEnd) {
      if (listening) return;
      listening = true;
      try {
        const perm = await SpeechRecognition.checkPermissions();
        if (perm.speechRecognition !== 'granted') {
          await SpeechRecognition.requestPermissions();
        }

        // Listen for partial results
        await SpeechRecognition.removeAllListeners();
        SpeechRecognition.addListener('partialResults', (data) => {
          if (data.matches && data.matches.length > 0) {
            // store latest; final delivered on stop
            AspenNative._lastPartial = data.matches[0];
          }
        });

        await SpeechRecognition.start({
          language: 'en-US',
          maxResults: 1,
          partialResults: true,
          popup: false,
        });

        // start() resolves with final matches on some platforms
      } catch (e) {
        console.error('[Native] STT start error', e);
        listening = false;
        onEnd && onEnd();
      }
    },

    async stopListening(onResult, onEnd) {
      if (!listening) return;
      try {
        await SpeechRecognition.stop();
        const final = AspenNative._lastPartial || '';
        AspenNative._lastPartial = '';
        listening = false;
        if (final && onResult) onResult(final);
        onEnd && onEnd();
      } catch (e) {
        console.error('[Native] STT stop error', e);
        listening = false;
        onEnd && onEnd();
      }
    },

    isListening() { return listening; },

    // Native TTS — far better voice quality than browser speechSynthesis
    async speak(text) {
      if (!text || !text.trim()) return;
      try {
        await TextToSpeech.speak({
          text: text.trim(),
          lang: 'en-US',
          rate: 1.0,
          pitch: 1.0,
          volume: 1.0,
          category: 'playback',
        });
      } catch (e) {
        console.error('[Native] TTS error', e);
      }
    },

    async stopSpeaking() {
      try { await TextToSpeech.stop(); } catch {}
    },
  };

  // Request permissions on load so the prompt appears early
  AspenNative.requestPermissions();

  window.AspenNative = AspenNative;
  console.log('[Native] Aspen native bridge ready');
})();
