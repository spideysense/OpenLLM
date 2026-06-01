import Foundation
import MLX
import KokoroSwift
import MLXUtilsLibrary

final class KokoroEngine: NSObject, AspenKokoroProvider {

    static let shared = KokoroEngine()

    private let modelRemote = URL(string: "https://huggingface.co/prince-canuma/Kokoro-82M/resolve/main/kokoro-v1_0.safetensors")!
    private let voicesRemote = URL(string: "https://huggingface.co/hexgrad/Kokoro-82M/resolve/main/voices.npz")!

    private var engine: KokoroTTS?
    private var voices: [String: MLXArray] = [:]
    private(set) var isReady = false
    private var isLoading = false
    private let defaultVoice = "af_heart"

    static func register() {
        AspenTTS.kokoroProvider = KokoroEngine.shared
    }

    private var cacheDir: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent("KokoroModel", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }
    private var modelPath: URL { cacheDir.appendingPathComponent("kokoro-v1_0.safetensors") }
    private var voicesPath: URL { cacheDir.appendingPathComponent("voices.npz") }

    var filesDownloaded: Bool {
        FileManager.default.fileExists(atPath: modelPath.path) &&
        FileManager.default.fileExists(atPath: voicesPath.path)
    }

    func ensureDownloaded(progress: @escaping (Double) -> Void,
                          completion: @escaping (Bool) -> Void) {
        if filesDownloaded { completion(true); return }
        downloadFile(from: voicesRemote, to: voicesPath, range: (0.0, 0.05), progress: progress) { ok in
            guard ok else { completion(false); return }
            self.downloadFile(from: self.modelRemote, to: self.modelPath, range: (0.05, 1.0), progress: progress) { ok2 in
                completion(ok2)
            }
        }
    }

    private func downloadFile(from url: URL, to dest: URL, range: (Double, Double),
                              progress: @escaping (Double) -> Void,
                              completion: @escaping (Bool) -> Void) {
        let delegate = DownloadProgressDelegate(range: range, onProgress: progress)
        let session = URLSession(configuration: .default, delegate: delegate, delegateQueue: nil)
        let task = session.downloadTask(with: url) { tempURL, _, error in
            guard let tempURL = tempURL, error == nil else {
                NSLog("[KokoroEngine] download failed \(url.lastPathComponent): \(String(describing: error))")
                completion(false); return
            }
            do {
                if FileManager.default.fileExists(atPath: dest.path) { try FileManager.default.removeItem(at: dest) }
                try FileManager.default.moveItem(at: tempURL, to: dest)
                completion(true)
            } catch {
                NSLog("[KokoroEngine] move failed: \(error)"); completion(false)
            }
        }
        task.resume()
    }

    @discardableResult
    func loadIfNeeded() -> Bool {
        if isReady { return true }
        guard filesDownloaded, !isLoading else { return false }
        isLoading = true
        defer { isLoading = false }
        let tts = KokoroTTS(modelPath: modelPath)
        let loaded = NpyzReader.read(fileFromPath: voicesPath) ?? [:]
        guard !loaded.isEmpty else { NSLog("[KokoroEngine] no voices loaded"); return false }
        engine = tts
        voices = loaded
        isReady = true
        NSLog("[KokoroEngine] ready, \(loaded.count) voices")
        return true
    }

    func synthesize(text: String, voiceName: String?) -> (samples: [Float], sampleRate: Int)? {
        guard isReady, let engine = engine else { return nil }
        let name = voiceName ?? defaultVoice
        guard let voice = voices[name + ".npy"] else { NSLog("[KokoroEngine] missing voice \(name)"); return nil }
        let language: KokoroTTS.Language = (name.first == "a") ? .enUS : .enGB
        do {
            let (audio, _) = try engine.generateAudio(voice: voice, language: language, text: text)
            return (audio.asArray(Float.self), KokoroTTS.Constants.samplingRate)
        } catch {
            NSLog("[KokoroEngine] generateAudio failed: \(error)")
            return nil
        }
    }
}

private final class DownloadProgressDelegate: NSObject, URLSessionDownloadDelegate {
    let range: (Double, Double)
    let onProgress: (Double) -> Void
    init(range: (Double, Double), onProgress: @escaping (Double) -> Void) {
        self.range = range; self.onProgress = onProgress
    }
    func urlSession(_ s: URLSession, downloadTask: URLSessionDownloadTask,
                    didWriteData bytesWritten: Int64, totalBytesWritten: Int64,
                    totalBytesExpectedToWrite: Int64) {
        guard totalBytesExpectedToWrite > 0 else { return }
        let frac = Double(totalBytesWritten) / Double(totalBytesExpectedToWrite)
        let mapped = range.0 + frac * (range.1 - range.0)
        DispatchQueue.main.async { self.onProgress(mapped) }
    }
    func urlSession(_ s: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {}
}
