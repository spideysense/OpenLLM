import Foundation
import Combine

/// A saved conversation (title + messages + timestamp).
struct Conversation: Identifiable, Codable, Equatable {
    var id = UUID()
    var title: String
    var messages: [ChatTurn]
    var updatedAt: Date = Date()

    /// First user message, trimmed, as the title.
    static func titleFrom(_ messages: [ChatTurn]) -> String {
        let first = messages.first { $0.role == "user" }?.content ?? "New chat"
        let t = first.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? "New chat" : String(t.prefix(60))
    }
}

/// Persists conversations to disk (JSON in Application Support). Simple,
/// synchronous, good enough for a phone-local history list.
@MainActor
final class ConversationStore: ObservableObject {
    static let shared = ConversationStore()
    @Published private(set) var conversations: [Conversation] = []

    private let url: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("aspen-conversations.json")
    }()

    init() { load() }

    func load() {
        guard let data = try? Data(contentsOf: url),
              let list = try? JSONDecoder().decode([Conversation].self, from: data) else { return }
        conversations = list.sorted { $0.updatedAt > $1.updatedAt }
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(conversations) {
            try? data.write(to: url, options: .atomic)
        }
    }

    /// Insert or update a conversation, keeping the list sorted by recency.
    func upsert(_ convo: Conversation) {
        var c = convo
        c.updatedAt = Date()
        if c.title == "New chat" || c.title.isEmpty { c.title = Conversation.titleFrom(c.messages) }
        if let i = conversations.firstIndex(where: { $0.id == c.id }) {
            conversations[i] = c
        } else {
            conversations.insert(c, at: 0)
        }
        conversations.sort { $0.updatedAt > $1.updatedAt }
        persist()
    }

    func delete(_ id: UUID) {
        conversations.removeAll { $0.id == id }
        persist()
    }

    func search(_ query: String) -> [Conversation] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return conversations }
        return conversations.filter {
            $0.title.lowercased().contains(q) ||
            $0.messages.contains { $0.content.lowercased().contains(q) }
        }
    }
}
