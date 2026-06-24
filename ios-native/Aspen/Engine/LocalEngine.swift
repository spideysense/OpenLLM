import Foundation
import Combine
import MLX
import MLXLLM
import MLXLMCommon

/// On-device model id, kept outside the @MainActor class so it can be used as a
/// default argument and referenced from any context (avoids the Swift 6
/// main-actor-isolation error).
/// ⚠️ VERIFY this id resolves on Hugging Face before shipping.
enum AspenModels {
    static let defaultId = "mlx-community/Llama-3.2-3B-Instruct-4bit"
}

/// On-device inference via Apple MLX (Metal). This is the same framework Locally
/// AI uses. The model container is loaded once and kept resident — that residency
/// is what makes follow-up turns instant.
///
/// API verified against WWDC25 ("Explore large language models on Apple silicon
/// with MLX") and ml-explore/mlx-swift-examples:
///   LLMModelFactory.shared.loadContainer(configuration:) -> ModelContainer
///   container.perform { context in try MLXLMCommon.generate(...) { token in ... } }
@MainActor
final class LocalEngine: ObservableObject {
    static let shared = LocalEngine()

    @Published var loadProgress: Double = 0      // 0..1 while a model downloads
    @Published var isLoaded = false
    private var maxProgressSeen: Double = 0       // clamp so progress never jumps backward

    private var container: ModelContainer?
    private var loadedModelId: String?

    /// Default on-device model: small, fast, fits any modern iPhone at 4-bit.
    /// (Id lives in AspenModels so it can be a default arg without actor issues.)
    static let defaultModelId = AspenModels.defaultId

    func loadIfNeeded(_ modelId: String = AspenModels.defaultId) async throws {
        if container != nil, loadedModelId == modelId { return }
        // Cap MLX's GPU cache so a phone under memory pressure doesn't get killed.
        MLX.GPU.set(cacheLimit: 20 * 1024 * 1024)
        loadProgress = 0
        maxProgressSeen = 0
        let configuration = ModelConfiguration(id: modelId)
        let c = try await LLMModelFactory.shared.loadContainer(configuration: configuration) { [weak self] progress in
            Task { @MainActor in
                guard let self else { return }
                // The model is many files; MLX's fractionCompleted resets/jumps as
                // each file downloads and as it recalculates the total. Clamp to the
                // max ever seen so the user sees a smooth, monotonic bar instead of
                // 90% -> 27% -> 80% bouncing.
                let f = progress.fractionCompleted
                if f > self.maxProgressSeen { self.maxProgressSeen = f }
                self.loadProgress = self.maxProgressSeen
            }
        }
        container = c
        loadedModelId = modelId
        isLoaded = true
        loadProgress = 1
    }

    /// Stream a reply token-by-token. `onToken` fires on the main actor as text
    /// arrives — wire it straight to the chat bubble for live streaming.
    /// Returns the full text. Honors `Task.isCancelled` for stop.
    func chat(
        messages: [ChatTurn],
        onToken: @escaping (String) -> Void
    ) async throws -> String {
        guard let container else { throw EngineError.notLoaded }

        // Same "no code unless asked / be concise" guard the box uses, so a 3B
        // doesn't dump HTML on "hello".
        let system = ChatTurn(
            role: "system",
            content: "You are Aspen, a private AI running entirely on this iPhone. "
                + "Nothing leaves the device. Be concise — lead with the answer. NEVER "
                + "write code or HTML unless the user explicitly asks you to build, write, "
                + "or fix something technical. Personal or casual messages get a warm, "
                + "plain reply, never code."
        )
        let full = [system] + messages

        return try await container.perform { context in
            let prompt = full.map { "\($0.role): \($0.content)" }.joined(separator: "\n") + "\nassistant:"
            let input = try await context.processor.prepare(input: UserInput(prompt: prompt))
            let params = GenerateParameters(temperature: 0.7)
            var text = ""
            let stream = try MLXLMCommon.generate(input: input, parameters: params, context: context)
            for await part in stream {
                if Task.isCancelled { break }
                if let chunk = part.chunk {
                    text += chunk
                    let snapshot = chunk
                    await MainActor.run { onToken(snapshot) }
                }
            }
            return text
        }
    }

    enum EngineError: Error { case notLoaded }
}

/// Minimal chat turn used by both engines (local + box).
struct ChatTurn: Identifiable, Codable, Equatable {
    var id = UUID()
    let role: String      // "user" | "assistant" | "system"
    var content: String
    var images: [String]? = nil   // base64 (no data: prefix), Ollama-style, for box vision
}
