import Foundation
import Speech
import AVFoundation

/// Native speech-to-text for voice mode. Streams live partial transcription,
/// publishes an audio level (0…1) for the animated orb, and fires `onSilence`
/// with the final text once the speaker pauses (~1.3s), so the conversation is
/// hands-free — no button to release.
@MainActor
final class SpeechRecognizer: ObservableObject {
    @Published var transcript = ""
    @Published var audioLevel: Float = 0
    @Published var available = true

    /// Called with the trimmed transcript when the speaker pauses.
    var onSilence: ((String) -> Void)?

    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private let audioEngine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var silenceTimer: Timer?

    /// Ask for speech + microphone permission. Returns true only if both granted.
    func requestAuth() async -> Bool {
        let speechOK = await withCheckedContinuation { (cont: CheckedContinuation<Bool, Never>) in
            SFSpeechRecognizer.requestAuthorization { cont.resume(returning: $0 == .authorized) }
        }
        let micOK = await withCheckedContinuation { (cont: CheckedContinuation<Bool, Never>) in
            AVAudioApplication.requestRecordPermission { cont.resume(returning: $0) }
        }
        return speechOK && micOK
    }

    func start() {
        stop()
        transcript = ""
        guard let recognizer, recognizer.isAvailable else { available = false; return }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .spokenAudio,
                                    options: [.duckOthers, .defaultToSpeaker, .allowBluetooth])
            try session.setActive(true, options: .notifyOthersOnDeactivation)

            let req = SFSpeechAudioBufferRecognitionRequest()
            req.shouldReportPartialResults = true
            request = req

            let input = audioEngine.inputNode
            let format = input.outputFormat(forBus: 0)
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
                req.append(buffer)
                let level = SpeechRecognizer.rms(buffer)
                Task { @MainActor [weak self] in self?.audioLevel = level }
            }
            audioEngine.prepare()
            try audioEngine.start()

            task = recognizer.recognitionTask(with: req) { [weak self] result, error in
                guard let self else { return }
                if let result {
                    Task { @MainActor in
                        self.transcript = result.bestTranscription.formattedString
                        self.resetSilenceTimer()
                    }
                }
                if error != nil || (result?.isFinal ?? false) {
                    Task { @MainActor in self.finishSegment() }
                }
            }
        } catch {
            available = false
        }
    }

    func stop() {
        silenceTimer?.invalidate(); silenceTimer = nil
        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        request?.endAudio(); request = nil
        task?.cancel(); task = nil
        audioLevel = 0
    }

    // MARK: - internals

    private func resetSilenceTimer() {
        silenceTimer?.invalidate()
        silenceTimer = Timer.scheduledTimer(withTimeInterval: 1.3, repeats: false) { [weak self] _ in
            Task { @MainActor in self?.finishSegment() }
        }
    }

    private func finishSegment() {
        let text = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        stop()
        if !text.isEmpty { onSilence?(text) }
    }

    /// RMS amplitude of a buffer, mapped to ~0…1. Runs off the main actor (called
    /// from the audio tap thread), so it's nonisolated and pure.
    nonisolated private static func rms(_ buffer: AVAudioPCMBuffer) -> Float {
        guard let ch = buffer.floatChannelData?[0] else { return 0 }
        let n = Int(buffer.frameLength)
        guard n > 0 else { return 0 }
        var sum: Float = 0
        for i in 0..<n { sum += ch[i] * ch[i] }
        let rms = (sum / Float(n)).squareRoot()
        return min(1, rms * 12)
    }
}
