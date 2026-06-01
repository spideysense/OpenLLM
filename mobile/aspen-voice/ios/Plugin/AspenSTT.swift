import Foundation
import Capacitor
import Speech
import AVFoundation

/**
 * AspenSTT — native iOS speech-to-text using Apple's Speech framework.
 *
 * Why this exists: the community SpeechRecognition plugin force-unwraps its
 * recognition request and CRASHES the whole Capacitor bridge when the on-device
 * recognizer fails to initialize (surfaces as "No speech detected" / nil unwrap).
 * This plugin guards every optional and rejects gracefully instead of trapping.
 *
 * Emits 'partialResults' (live transcript) and 'listeningState' (started/stopped)
 * events so the JS bridge can drive silence-based auto-submit, matching the
 * interface the existing native-bridge.js already expects.
 */
@objc(AspenSTT)
public class AspenSTT: CAPPlugin, CAPBridgedPlugin, SFSpeechRecognizerDelegate {
    public let identifier = "AspenSTT"
    public let jsName = "AspenSTT"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "checkPerms", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPerms", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private let speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private let audioEngine = AVAudioEngine()
    private var isRunning = false

    // MARK: - Permissions

    @objc func checkPerms(_ call: CAPPluginCall) {
        let speechState = AspenSTT.authString(SFSpeechRecognizer.authorizationStatus())
        let micState: String
        if #available(iOS 17.0, *) {
            micState = AspenSTT.micString(AVAudioApplication.shared.recordPermission)
        } else {
            micState = AspenSTT.micString(AVAudioSession.sharedInstance().recordPermission)
        }
        call.resolve(["speechRecognition": speechState, "microphone": micState])
    }

    @objc func requestPerms(_ call: CAPPluginCall) {
        SFSpeechRecognizer.requestAuthorization { speechStatus in
            let requestMic: (@escaping (Bool) -> Void) -> Void = { completion in
                if #available(iOS 17.0, *) {
                    AVAudioApplication.requestRecordPermission(completionHandler: completion)
                } else {
                    AVAudioSession.sharedInstance().requestRecordPermission(completion)
                }
            }
            requestMic { _ in
                let speechState = AspenSTT.authString(speechStatus)
                let micState: String
                if #available(iOS 17.0, *) {
                    micState = AspenSTT.micString(AVAudioApplication.shared.recordPermission)
                } else {
                    micState = AspenSTT.micString(AVAudioSession.sharedInstance().recordPermission)
                }
                call.resolve(["speechRecognition": speechState, "microphone": micState])
            }
        }
    }

    // MARK: - Start / Stop

    @objc func start(_ call: CAPPluginCall) {
        // Guard: authorization
        guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
            call.reject("Speech recognition not authorized")
            return
        }
        // Guard: recognizer exists and is available (THIS is what the community plugin
        // failed to check before force-unwrapping → crash).
        guard let recognizer = speechRecognizer, recognizer.isAvailable else {
            call.reject("Speech recognizer unavailable on this device right now")
            return
        }
        if isRunning {
            call.resolve()
            return
        }

        DispatchQueue.main.async {
            do {
                try self.beginSession(recognizer: recognizer)
                self.isRunning = true
                self.notifyListeners("listeningState", data: ["status": "started"])
                call.resolve()
            } catch {
                self.cleanup()
                call.reject("Could not start listening: \(error.localizedDescription)")
            }
        }
    }

    private func beginSession(recognizer: SFSpeechRecognizer) throws {
        // Tear down any prior task
        recognitionTask?.cancel()
        recognitionTask = nil

        let audioSession = AVAudioSession.sharedInstance()
        try audioSession.setCategory(.record, mode: .measurement, options: .duckOthers)
        try audioSession.setActive(true, options: .notifyOthersOnDeactivation)

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        // Prefer on-device when supported; falls back to server automatically if not.
        if recognizer.supportsOnDeviceRecognition {
            request.requiresOnDeviceRecognition = true
        }
        recognitionRequest = request

        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)
        // Guard against a 0-channel/invalid format (another crash source on some devices).
        guard recordingFormat.channelCount > 0 else {
            throw NSError(domain: "AspenSTT", code: -1,
                          userInfo: [NSLocalizedDescriptionKey: "No audio input available"])
        }

        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { [weak self] buffer, _ in
            self?.recognitionRequest?.append(buffer)
        }

        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let self = self else { return }
            if let result = result {
                let text = result.bestTranscription.formattedString
                self.notifyListeners("partialResults", data: ["matches": [text]])
            }
            // On error or final result, stop cleanly.
            if error != nil || (result?.isFinal ?? false) {
                self.finishAndNotify()
            }
        }

        audioEngine.prepare()
        try audioEngine.start()
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.finishAndNotify()
            call.resolve()
        }
    }

    private func finishAndNotify() {
        guard isRunning else { return }
        cleanup()
        notifyListeners("listeningState", data: ["status": "stopped"])
    }

    private func cleanup() {
        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        recognitionRequest?.endAudio()
        recognitionRequest = nil
        recognitionTask?.cancel()
        recognitionTask = nil
        isRunning = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    // MARK: - Helpers

    private static func authString(_ status: SFSpeechRecognizerAuthorizationStatus) -> String {
        switch status {
        case .authorized: return "granted"
        case .denied, .restricted: return "denied"
        case .notDetermined: return "prompt"
        @unknown default: return "prompt"
        }
    }

    private static func micString(_ status: AVAudioSession.RecordPermission) -> String {
        switch status {
        case .granted: return "granted"
        case .denied: return "denied"
        case .undetermined: return "prompt"
        @unknown default: return "prompt"
        }
    }

    @available(iOS 17.0, *)
    private static func micString(_ status: AVAudioApplication.recordPermission) -> String {
        switch status {
        case .granted: return "granted"
        case .denied: return "denied"
        case .undetermined: return "prompt"
        @unknown default: return "prompt"
        }
    }
}
