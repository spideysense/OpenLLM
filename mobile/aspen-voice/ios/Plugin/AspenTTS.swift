import Foundation
import Capacitor
import AVFoundation

/// Bridge so the AspenVoice pod can use Kokoro (which lives in the App target,
/// where the MLX/KokoroSwift SPM packages are available) without importing MLX itself.
public protocol AspenKokoroProvider: AnyObject {
    var isReady: Bool { get }
    var filesDownloaded: Bool { get }
    func ensureDownloaded(progress: @escaping (Double) -> Void, completion: @escaping (Bool) -> Void)
    func loadIfNeeded() -> Bool
    func synthesize(text: String, voiceName: String?) -> (samples: [Float], sampleRate: Int)?
}

@objc(AspenTTS)
public class AspenTTS: CAPPlugin, CAPBridgedPlugin, AVSpeechSynthesizerDelegate {
    public let identifier = "AspenTTS"
    public let jsName = "AspenTTS"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "prepareVoice", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "voiceStatus", returnType: CAPPluginReturnPromise)
    ]

    private let synthesizer = AVSpeechSynthesizer()
    private var cachedVoice: AVSpeechSynthesisVoice?
    private var pendingCall: CAPPluginCall?

    private let audioEngine = AVAudioEngine()
    private let playerNode = AVAudioPlayerNode()
    private var kokoroAttached = false

    public static weak var kokoroProvider: AspenKokoroProvider?

    override public func load() {
        synthesizer.delegate = self
    }

    private func bestVoice() -> AVSpeechSynthesisVoice? {
        if let cached = cachedVoice { return cached }
        let lang = "en-US"
        let voices = AVSpeechSynthesisVoice.speechVoices().filter { $0.language == lang }
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
        if let kokoro = AspenTTS.kokoroProvider, kokoro.isReady {
            self.pendingCall?.resolve()
            self.pendingCall = call
            DispatchQueue.global(qos: .userInitiated).async {
                if let result = kokoro.synthesize(text: text, voiceName: nil) {
                    do {
                        try self.playSamples(result.samples, sampleRate: result.sampleRate, for: call)
                    } catch {
                        NSLog("[AspenTTS] Kokoro playback failed, falling back: \(error)")
                        DispatchQueue.main.async { self.speakWithApple(text: text, call: call) }
                    }
                } else {
                    DispatchQueue.main.async { self.speakWithApple(text: text, call: call) }
                }
            }
        } else {
            speakWithApple(text: text, call: call)
        }
    }

    private func speakWithApple(text: String, call: CAPPluginCall) {
        let rate = Float(call.getDouble("rate") ?? Double(AVSpeechUtteranceDefaultSpeechRate))
        let pitch = Float(call.getDouble("pitch") ?? 1.0)
        let volume = Float(call.getDouble("volume") ?? 1.0)
        DispatchQueue.main.async {
            self.configureAudioSession()
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
            self.synthesizer.speak(utterance)
        }
    }

    private func playSamples(_ samples: [Float], sampleRate: Int, for call: CAPPluginCall) throws {
        let format = AVAudioFormat(commonFormat: .pcmFormatFloat32,
                                   sampleRate: Double(sampleRate),
                                   channels: 1,
                                   interleaved: false)!
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count)) else {
            throw NSError(domain: "AspenTTS", code: 1)
        }
        buffer.frameLength = AVAudioFrameCount(samples.count)
        if let ch = buffer.floatChannelData {
            samples.withUnsafeBufferPointer { src in
                ch[0].update(from: src.baseAddress!, count: samples.count)
            }
        }
        DispatchQueue.main.async {
            self.configureAudioSession()
            if !self.kokoroAttached {
                self.audioEngine.attach(self.playerNode)
                self.audioEngine.connect(self.playerNode, to: self.audioEngine.mainMixerNode, format: format)
                self.kokoroAttached = true
            }
            if !self.audioEngine.isRunning {
                try? self.audioEngine.start()
            }
            self.playerNode.stop()
            self.playerNode.scheduleBuffer(buffer, at: nil, options: []) {
                DispatchQueue.main.async {
                    call.resolve()
                    if self.pendingCall === call { self.pendingCall = nil }
                }
            }
            self.playerNode.play()
        }
    }

    @objc func prepareVoice(_ call: CAPPluginCall) {
        guard let kokoro = AspenTTS.kokoroProvider else {
            call.resolve(["ready": false, "available": false]); return
        }
        if kokoro.isReady { call.resolve(["ready": true]); return }
        kokoro.ensureDownloaded(progress: { [weak self] p in
            self?.notifyListeners("kokoroProgress", data: ["progress": p])
        }, completion: { [weak self] ok in
            guard ok else {
                self?.notifyListeners("kokoroProgress", data: ["progress": 0, "failed": true])
                call.resolve(["ready": false]); return
            }
            let loaded = kokoro.loadIfNeeded()
            self?.notifyListeners("kokoroProgress", data: ["progress": 1.0, "ready": loaded])
            call.resolve(["ready": loaded])
        })
    }

    @objc func voiceStatus(_ call: CAPPluginCall) {
        let kokoro = AspenTTS.kokoroProvider
        call.resolve([
            "available": kokoro != nil,
            "downloaded": kokoro?.filesDownloaded ?? false,
            "ready": kokoro?.isReady ?? false
        ])
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if self.synthesizer.isSpeaking {
                self.synthesizer.stopSpeaking(at: .immediate)
            }
            if self.playerNode.isPlaying {
                self.playerNode.stop()
            }
            self.pendingCall?.resolve()
            self.pendingCall = nil
            call.resolve()
        }
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        pendingCall?.resolve()
        pendingCall = nil
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
    }
}
