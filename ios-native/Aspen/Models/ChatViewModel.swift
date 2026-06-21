import Foundation
import Combine
import SwiftUI

enum Tier: String, Codable { case local, box }

/// Drives one chat. Holds the messages, the current tier, and the live "status"
/// line that powers the rich thinking / tool-call narration. Streaming on both
/// tiers updates the last assistant bubble token-by-token.
@MainActor
final class ChatViewModel: ObservableObject {
    @Published var messages: [ChatTurn] = []
    @Published var input = ""
    @Published var streaming = false
    @Published var status = ""              // "Thinking…", "Searching the web…"
    @Published var tier: Tier = .local
    @Published var footerModel = "On iPhone"

    var boxConfig: BoxClient.Config? { didSet { persistBox() } }
    var boxModel = ""
    private var task: Task<Void, Never>?
    private var currentId = UUID()
    private let store = ConversationStore.shared

    init() {
        // Restore a saved box connection so returning users land already connected.
        if let data = UserDefaults.standard.data(forKey: "boxConfig"),
           let cfg = try? JSONDecoder().decode(BoxClient.Config.self, from: data) {
            boxConfig = cfg
        }
        // Restore the model name too — without it, the box receives an empty model
        // and hangs (the cause of the box-mode "request timed out").
        boxModel = UserDefaults.standard.string(forKey: "boxModel") ?? ""
        if let saved = UserDefaults.standard.string(forKey: "lastTier"), saved == "box", boxConfig != nil {
            tier = .box
            footerModel = "On your Aspen\(boxModel.isEmpty ? "" : " · \(boxModel)")"
        }
        // If we're connected but lost the model (e.g. older saved state), re-fetch.
        if boxConfig != nil, boxModel.isEmpty { Task { await refreshBoxModel() } }
    }

    /// Re-fetch the box's model list and pick a chat model. Used on restore and as
    /// a safety net before sending if the model went missing.
    func refreshBoxModel() async {
        guard let cfg = boxConfig else { return }
        if let models = try? await BoxClient.fetchModels(cfg), !models.isEmpty {
            let chat = models.first { !$0.lowercased().contains("coder") } ?? models.first ?? ""
            boxModel = chat
            UserDefaults.standard.set(chat, forKey: "boxModel")
            if tier == .box { footerModel = "On your Aspen\(chat.isEmpty ? "" : " · \(chat)")" }
        }
    }

    private func persistBox() {
        if let cfg = boxConfig, let data = try? JSONEncoder().encode(cfg) {
            UserDefaults.standard.set(data, forKey: "boxConfig")
        } else {
            UserDefaults.standard.removeObject(forKey: "boxConfig")
        }
    }

    func setTier(_ t: Tier) {
        tier = t
        footerModel = t == .box ? "On your Aspen\(boxModel.isEmpty ? "" : " · \(boxModel)")" : "On iPhone"
        UserDefaults.standard.set(t.rawValue, forKey: "lastTier")
    }

    func connected(_ cfg: BoxClient.Config, _ models: [String]) {
        boxConfig = cfg
        // Default to a CHAT model, never a coder — otherwise the footer shows
        // "qwen2.5-coder" before any turn. The box's per-turn aspen_model event
        // corrects this after the first message, but the initial label matters.
        boxModel = models.first { !$0.lowercased().contains("coder") } ?? models.first ?? ""
        UserDefaults.standard.set(boxModel, forKey: "boxModel")
        setTier(.box)
    }

    func send() {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !streaming else { return }
        input = ""
        messages.append(ChatTurn(role: "user", content: text))
        // Placeholder assistant bubble that streams in.
        messages.append(ChatTurn(role: "assistant", content: ""))
        streaming = true
        status = "Thinking…"

        let history = messages.dropLast().map { $0 }
        task = Task { await run(history: Array(history)) }
    }

    func stop() {
        task?.cancel()
        finish()
    }

    /// Start a fresh conversation.
    func newChat() {
        task?.cancel()
        currentId = UUID()
        messages = []
        status = ""
        streaming = false
        input = ""
    }

    /// Load a saved conversation into the view.
    func load(_ convo: Conversation) {
        task?.cancel()
        currentId = convo.id
        messages = convo.messages
        status = ""
        streaming = false
        input = ""
    }

    /// Save the current conversation (called after each completed turn).
    private func save() {
        guard !messages.isEmpty else { return }
        store.upsert(Conversation(id: currentId, title: Conversation.titleFrom(messages), messages: messages))
    }

    private func run(history: [ChatTurn]) async {
        do {
            if tier == .box, let cfg = boxConfig {
                // Never send an empty model — the box hangs on it. Re-fetch first.
                if boxModel.isEmpty { await refreshBoxModel() }
                try await BoxClient.chat(
                    config: cfg, model: boxModel, messages: history,
                    onStatus: { [weak self] s in Task { @MainActor in self?.status = s } },
                    onModel:  { [weak self] m in Task { @MainActor in self?.footerModel = "On your Aspen · \(m)" } },
                    onToken:  { [weak self] t in Task { @MainActor in self?.appendToken(t) } }
                )
            } else {
                try await LocalEngine.shared.loadIfNeeded()
                status = ""
                _ = try await LocalEngine.shared.chat(
                    messages: history,
                    onToken: { [weak self] t in Task { @MainActor in self?.appendToken(t) } }
                )
            }
            finish()
        } catch is CancellationError {
            finish()
        } catch {
            appendToken("\n⚠️ \(error.localizedDescription)")
            finish()
        }
    }

    private func appendToken(_ t: String) {
        if status != "" { status = "" }   // first token clears the thinking line
        guard let last = messages.indices.last else { return }
        messages[last].content += t
    }

    private func finish() {
        streaming = false
        status = ""
        let haptic = UIImpactFeedbackGenerator(style: .soft)
        haptic.impactOccurred()
        save()
    }
}
