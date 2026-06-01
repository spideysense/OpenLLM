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

    // Native STT with silence auto-detect — auto-submits when you stop talking
    async startListening(onResult, onEnd) {
      if (listening) return;
      listening = true;
      AspenNative._lastPartial = '';
      AspenNative._onResult = onResult;
      AspenNative._onEnd = onEnd;
      AspenNative._silenceTimer = null;

      const resetSilence = () => {
        if (AspenNative._silenceTimer) clearTimeout(AspenNative._silenceTimer);
        // Auto-stop after 1.5s of no new speech
        AspenNative._silenceTimer = setTimeout(() => {
          AspenNative.stopListening(AspenNative._onResult, AspenNative._onEnd);
        }, 1500);
      };

      try {
        const perm = await SpeechRecognition.checkPermissions();
        if (perm.speechRecognition !== 'granted') {
          await SpeechRecognition.requestPermissions();
        }

        await SpeechRecognition.removeAllListeners();
        SpeechRecognition.addListener('partialResults', (data) => {
          if (data.matches && data.matches.length > 0) {
            AspenNative._lastPartial = data.matches[0];
            resetSilence(); // each new partial resets the silence countdown
          }
        });
        SpeechRecognition.addListener('listeningState', (data) => {
          if (data && data.status === 'stopped') {
            // OS ended the session
            const final = AspenNative._lastPartial || '';
            if (listening) {
              listening = false;
              if (AspenNative._silenceTimer) clearTimeout(AspenNative._silenceTimer);
              if (final && AspenNative._onResult) AspenNative._onResult(final);
              AspenNative._onEnd && AspenNative._onEnd();
            }
          }
        });

        await SpeechRecognition.start({
          language: 'en-US',
          maxResults: 1,
          partialResults: true,
          popup: false,
        });
        resetSilence(); // start the initial countdown (in case nothing is said)
      } catch (e) {
        console.error('[Native] STT start error', e);
        listening = false;
        onEnd && onEnd();
      }
    },

    async stopListening(onResult, onEnd) {
      if (!listening) return;
      if (AspenNative._silenceTimer) { clearTimeout(AspenNative._silenceTimer); AspenNative._silenceTimer = null; }
      try {
        await SpeechRecognition.stop();
      } catch (e) {
        console.error('[Native] STT stop error', e);
      }
      const final = AspenNative._lastPartial || '';
      AspenNative._lastPartial = '';
      listening = false;
      if (final && onResult) onResult(final);
      onEnd && onEnd();
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


  // Keyboard: manually shrink the app to sit above the keyboard.

  // iOS resizes the webview natively (resize:native), so we only need to
  // keep the latest message in view when the keyboard opens.
  const Keyboard = Cap.Plugins.Keyboard;
  if (Keyboard) {
    const scrollDown = () => {
      const m = document.getElementById('messages');
      if (m) m.scrollTop = m.scrollHeight;
    };
    Keyboard.addListener('keyboardWillShow', () => {
      // Keyboard covers the home-indicator area, so remove the safe-area bottom padding
      document.documentElement.style.setProperty('--input-pb', '0.6rem');
      setTimeout(scrollDown, 100);
    });
    Keyboard.addListener('keyboardDidShow', scrollDown);
    Keyboard.addListener('keyboardWillHide', () => {
      document.documentElement.style.removeProperty('--input-pb');
    });
  }

  window.AspenNative = AspenNative;
  console.log('[Native] Aspen native bridge ready');
})();
