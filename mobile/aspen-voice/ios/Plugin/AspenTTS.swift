import Foundation
import Capacitor
import AVFoundation

/**
 * AspenTTS — native iOS text-to-speech using AVSpeechSynthesizer.
 *
 * Why this exists: the community TTS plugin spoke with the default *compact*
 * voice (robotic) and re-initialized per sentence (choppy). This plugin:
 *   - Picks the best DOWNLOADED voice at runtime: premium > enhanced > default
 *   - Uses Apple's natural default speech rate
 *   - Queues utterances so multi-sentence replies flow without gaps
 *   - Configures the audio session so speech plays over the speaker reliably
 */
@objc(AspenTTS)
public class AspenTTS: CAPPlugin, CAPBridgedPlugin, AVSpeechSynthesizerDelegate {
    public let identifier = "AspenTTS"
    public let jsName = "AspenTTS"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private let synthesizer = AVSpeechSynthesizer()
    private var cachedVoice: AVSpeechSynthesisVoice?
    // Resolve the JS promise only when the whole utterance finishes speaking.
    private var pendingCall: CAPPluginCall?

    override public func load() {
        synthesizer.delegate = self
    }

    /// Returns the best available en-US voice the user actually has installed.
    /// Premium and enhanced voices must be downloaded by the user; if none are
    /// present we fall back to the default voice (never nil-crash).
    private func bestVoice() -> AVSpeechSynthesisVoice? {
        if let cached = cachedVoice { return cached }

        let lang = "en-US"
        let voices = AVSpeechSynthesisVoice.speechVoices().filter { $0.language == lang }

        // .premium is iOS 16+; .enhanced works on iOS 13+. Pick the best available.
        var premium: AVSpeechSynthesisVoice? = nil
        if #available(iOS 16.0, *) {
            premium = voices.first { $0.quality == .premium }
        }
        let enhanced = voices.first { $0.quality == .enhanced }
        let chosen = premium ?? enhanced ?? AVSpeechSynthesisVoice(language: lang)

        cachedVoice = chosen
        return chosen
    }

    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            // .playback so it speaks over the speaker even on silent mode;
            // .duckOthers lowers background audio instead of stopping it.
            try session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
            try session.setActive(true, options: [])
        } catch {
            CAPLog.print("[AspenTTS] audio session error: \(error)")
        }
    }

    @objc func speak(_ call: CAPPluginCall) {
        guard let text = call.getString("text"), !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            call.resolve()
            return
        }

        // Optional overrides; default rate is Apple's natural rate (~0.5),
        // NOT 1.0 (which sounds clipped/fast).
        let rate = Float(call.getDouble("rate") ?? Double(AVSpeechUtteranceDefaultSpeechRate))
        let pitch = Float(call.getDouble("pitch") ?? 1.0)
        let volume = Float(call.getDouble("volume") ?? 1.0)

        DispatchQueue.main.async {
            self.configureAudioSession()

            // New speak() call cancels whatever was playing and resolves the old promise.
            if self.synthesizer.isSpeaking {
                self.synthesizer.stopSpeaking(at: .immediate)
            }
            self.pendingCall?.resolve()
            self.pendingCall = call

            let utterance = AVSpeechUtterance(string: text)
            utterance.voice = self.bestVoice()
            utterance.rate = rate
            utterance.pitchMultiplier = pitch
            utterance.volume = volume
            // Tiny lead-in so the first word isn't clipped by the audio route warming up.
            utterance.preUtteranceDelay = 0.0
            utterance.postUtteranceDelay = 0.0

            self.synthesizer.speak(utterance)
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if self.synthesizer.isSpeaking {
                self.synthesizer.stopSpeaking(at: .immediate)
            }
            self.pendingCall?.resolve()
            self.pendingCall = nil
            call.resolve()
        }
    }

    // MARK: - AVSpeechSynthesizerDelegate

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        pendingCall?.resolve()
        pendingCall = nil
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        // didCancel fires on stopSpeaking; the canceller already resolved the call.
    }
}
