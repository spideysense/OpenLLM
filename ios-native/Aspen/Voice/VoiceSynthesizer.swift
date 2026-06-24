import Foundation
import AVFoundation

/// Speaks assistant replies. Primary path is the box's neural TTS (/api/tts —
/// Azure/Google), which streams back MP3 and sounds far better than the on-device
/// synth; if that returns no audio (no key / error) it falls back to
/// AVSpeechSynthesizer. Sentences are spoken one at a time, in order, so a reply
/// can start speaking before it has finished streaming.
@MainActor
final class VoiceSynthesizer: NSObject, ObservableObject {
    @Published var isSpeaking = false

    private var queue: [String] = []
    private var draining = false
    private var player: AVAudioPlayer?
    private let synth = AVSpeechSynthesizer()
    private var playFinish: CheckedContinuation<Void, Never>?
    private var speechFinish: CheckedContinuation<Void, Never>?

    private static let ttsURL = URL(string: "https://www.runonaspen.com/api/tts")!

    override init() {
        super.init()
        synth.delegate = self
    }

    func enqueue(_ sentence: String) {
        let s = sentence.trimmingCharacters(in: .whitespacesAndNewlines)
        guard s.count > 2 else { return }
        queue.append(s)
        if !draining { Task { await drain() } }
    }

    func stopAll() {
        queue.removeAll()
        player?.stop(); player = nil
        synth.stopSpeaking(at: .immediate)
        playFinish?.resume(); playFinish = nil
        speechFinish?.resume(); speechFinish = nil
        draining = false
        isSpeaking = false
    }

    // MARK: - internals

    private func drain() async {
        draining = true
        isSpeaking = true
        while !queue.isEmpty {
            let next = queue.removeFirst()
            if let data = await fetchTTS(next) {
                await playData(data)
            } else {
                await speakOnDevice(next)
            }
        }
        draining = false
        isSpeaking = false
    }

    private func fetchTTS(_ text: String) async -> Data? {
        var req = URLRequest(url: Self.ttsURL)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["text": text])
        req.timeoutInterval = 15
        guard let (data, resp) = try? await URLSession.shared.data(for: req),
              let http = resp as? HTTPURLResponse, http.statusCode == 200 else { return nil }
        let ctype = (http.value(forHTTPHeaderField: "Content-Type") ?? "").lowercased()
        // Audio => play it; JSON {useBrowser:true} => nil => on-device fallback.
        return ctype.contains("audio") ? data : nil
    }

    private func playData(_ data: Data) async {
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            do {
                let session = AVAudioSession.sharedInstance()
                try session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
                try session.setActive(true)
                let p = try AVAudioPlayer(data: data)
                player = p
                playFinish = cont
                p.delegate = self
                p.play()
            } catch {
                cont.resume()
            }
        }
    }

    private func speakOnDevice(_ text: String) async {
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            let u = AVSpeechUtterance(string: text)
            // Prefer an enhanced/premium en-US voice if the user has one installed.
            u.voice = AVSpeechSynthesisVoice.speechVoices()
                .first(where: { $0.language == "en-US" && $0.quality == .enhanced })
                ?? AVSpeechSynthesisVoice(language: "en-US")
            u.rate = 0.5
            speechFinish = cont
            synth.speak(u)
        }
    }
}

extension VoiceSynthesizer: AVAudioPlayerDelegate, AVSpeechSynthesizerDelegate {
    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in self.playFinish?.resume(); self.playFinish = nil }
    }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in self.speechFinish?.resume(); self.speechFinish = nil }
    }
}
