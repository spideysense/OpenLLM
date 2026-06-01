import Foundation
import AspenVoice
import MLX
import KokoroSwift

final class KokoroEngine: NSObject, AspenKokoroProvider {

    static let shared = KokoroEngine()

    private let modelRemote = URL(string: "https://huggingface.co/prince-canuma/Kokoro-82M/resolve/main/kokoro-v1_0.safetensors")!

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
    private var voicesPath: URL { Bundle.main.url(forResource: "voices", withExtension: "npz")! }

    var filesDownloaded: Bool {
        FileManager.default.fileExists(atPath: modelPath.path)
    }

    func ensureDownloaded(progress: @escaping (Double) -> Void,
                          completion: @escaping (Bool) -> Void) {
        if filesDownloaded { completion(true); return }
        downloadFile(from: modelRemote, to: modelPath, range: (0.0, 1.0), progress: progress) { ok in
            completion(ok)
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
        let loaded = (try? loadArrays(url: voicesPath)) ?? [:]
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
        let language: Language = (name.first == "a") ? .enUS : .enGB
        do {
            let (audio, _) = try engine.generateAudio(voice: voice, language: language, text: text)
            return (audio, KokoroTTS.Constants.samplingRate)
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
