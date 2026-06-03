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

  // STT: prefer our crash-safe native plugin; fall back to community plugin.
  const AspenSTT = Cap.Plugins.AspenSTT;
  const SpeechRecognition = AspenSTT || Cap.Plugins.SpeechRecognition;
  // AspenTTS: custom native plugin (AVSpeechSynthesizer, premium/enhanced voice).
  // Falls back to the community TextToSpeech plugin if for some reason it's absent.
  const AspenTTS = Cap.Plugins.AspenTTS;
  const TextToSpeech = Cap.Plugins.TextToSpeech;

  // Permission methods differ: AspenSTT uses checkPerms/requestPerms (renamed to
  // avoid colliding with CAPPlugin's built-ins); community plugin uses the
  // checkPermissions/requestPermissions names. Pick the right one.
  const sttCheckPerms = () =>
    AspenSTT ? SpeechRecognition.checkPerms() : SpeechRecognition.checkPermissions();
  const sttRequestPerms = () =>
    AspenSTT ? SpeechRecognition.requestPerms() : SpeechRecognition.requestPermissions();

  let listening = false;

  const AspenNative = {
    available: true,

    async requestPermissions() {
      try {
        await sttRequestPerms();
        return true;
      } catch (e) {
        console.error('[Native] permission error', e);
        return false;
      }
    },

    // Native STT with silence auto-detect — auto-submits when you stop talking
    async startListening(onResult, onEnd) {
      if (!SpeechRecognition) { onEnd && onEnd(); return; }
      if (listening) return;
      listening = true;
      AspenNative._lastPartial = '';
      AspenNative._onResult = onResult;
      AspenNative._onEnd = onEnd;
      AspenNative._silenceTimer = null;

      const resetSilence = () => {
        if (AspenNative._silenceTimer) clearTimeout(AspenNative._silenceTimer);
        // Auto-stop after 2.5s of no new speech (allows natural pauses)
        AspenNative._silenceTimer = setTimeout(() => {
          AspenNative.stopListening(AspenNative._onResult, AspenNative._onEnd);
        }, 2500);
      };

      try {
        const perm = await sttCheckPerms();
        if (perm.speechRecognition !== 'granted') {
          await sttRequestPerms();
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
        // Grace period: give the user up to 6s to START talking. The 2.5s
        // silence timer only takes over once the first words are detected
        // (resetSilence is called from the partialResults listener).
        if (AspenNative._silenceTimer) clearTimeout(AspenNative._silenceTimer);
        AspenNative._silenceTimer = setTimeout(() => {
          AspenNative.stopListening(AspenNative._onResult, AspenNative._onEnd);
        }, 6000);
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

    // Native TTS — AspenTTS (AVSpeechSynthesizer, premium/enhanced voice).
    async speak(text) {
      if (!text || !text.trim()) return;
      try {
        if (AspenTTS) {
          // rate omitted → native uses Apple's natural default rate.
          await AspenTTS.speak({ text: text.trim() });
        } else {
          // Fallback: community plugin (lower quality, but better than nothing).
          await TextToSpeech.speak({
            text: text.trim(), lang: 'en-US', rate: 1.0, pitch: 1.0, volume: 1.0, category: 'playback',
          });
        }
      } catch (e) {
        console.error('[Native] TTS error', e);
      }
    },

    async stopSpeaking() {
      try {
        if (AspenTTS) { await AspenTTS.stop(); }
        else { await TextToSpeech.stop(); }
      } catch {}
    },

    // Kokoro neural voice: check status, trigger the on-demand model download.
    async voiceStatus() {
      try {
        if (AspenTTS && AspenTTS.voiceStatus) return await AspenTTS.voiceStatus();
      } catch (e) { console.error('[Native] voiceStatus error', e); }
      return { available: false, downloaded: false, ready: false };
    },
    async prepareVoice() {
      try {
        if (AspenTTS && AspenTTS.prepareVoice) return await AspenTTS.prepareVoice();
      } catch (e) { console.error('[Native] prepareVoice error', e); }
      return { ready: false };
    },
    onVoiceProgress(cb) {
      try {
        if (AspenTTS && AspenTTS.addListener) {
          AspenTTS.addListener('kokoroProgress', (data) => cb(data));
        }
      } catch (e) { console.error('[Native] onVoiceProgress error', e); }
    },
    async setVoiceEngine(engine) {
      // engine: 'natural' (Kokoro) or 'fast' (Apple AVSpeechSynthesizer)
      try {
        if (AspenTTS && AspenTTS.setEngine) return await AspenTTS.setEngine({ engine });
      } catch (e) { console.error('[Native] setVoiceEngine error', e); }
      return null;
    },
  };

  // Voice/mic is disabled on iOS (Web Speech unsupported in WebView), so we do
  // NOT request microphone permission on launch — requesting access for a
  // capability the app doesn't use is both pointless and an App Store rejection
  // risk (Guideline 5.1.1).


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
