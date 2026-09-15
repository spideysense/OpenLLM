import Foundation
import AVFoundation

/// Speaks with installed system voices. Reply text never leaves the device.
@MainActor
final class VoiceSynthesizer: NSObject, ObservableObject {
    @Published var isSpeaking = false
    private var queue: [String] = []
    private var draining = false
    private var generation = 0
    private let synth = AVSpeechSynthesizer()
    private var current: AVSpeechUtterance?
    private var speechFinish: CheckedContinuation<Void, Never>?

    override init() { super.init(); synth.delegate = self }

    func enqueue(_ sentence: String) {
        let text = sentence.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.count > 2 else { return }
        queue.append(text)
        guard !draining else { return }
        draining = true
        let ticket = generation
        Task { await drain(ticket) }
    }

    func stopAll() {
        generation += 1
        queue.removeAll()
        current = nil
        let finish = speechFinish; speechFinish = nil
        synth.stopSpeaking(at: .immediate)
        finish?.resume()
        draining = false
        isSpeaking = false
    }

    private func drain(_ ticket: Int) async {
        guard ticket == generation else { return }
        isSpeaking = true
        while ticket == generation && !queue.isEmpty {
            let text = queue.removeFirst()
            await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
                let utterance = AVSpeechUtterance(string: text)
                utterance.voice = AVSpeechSynthesisVoice.speechVoices()
                    .first(where: { $0.language == "en-US" && $0.quality == .enhanced })
                    ?? AVSpeechSynthesisVoice(language: "en-US")
                utterance.rate = 0.5
                current = utterance
                speechFinish = cont
                synth.speak(utterance)
            }
        }
        guard ticket == generation else { return }
        draining = false
        isSpeaking = false
    }

    private func finish(_ utterance: AVSpeechUtterance) {
        guard current === utterance else { return }
        current = nil
        let continuation = speechFinish; speechFinish = nil
        continuation?.resume()
    }
}

extension VoiceSynthesizer: AVSpeechSynthesizerDelegate {
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in self.finish(utterance) }
    }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in self.finish(utterance) }
    }
}
