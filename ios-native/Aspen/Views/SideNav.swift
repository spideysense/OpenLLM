import SwiftUI

/// Left navigation drawer (the burger menu). Top: nav items (New chat, Home,
/// Settings). Below: a search field and the conversation history list.
struct SideNav: View {
    @ObservedObject var store = ConversationStore.shared
    let tier: Tier
    let boxConnected: Bool

    var onNewChat: () -> Void
    var onOpenChat: (Conversation) -> Void
    var onSettings: () -> Void
    var onClose: () -> Void

    @State private var query = ""

    private var results: [Conversation] { store.search(query) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            HStack {
                Text("Aspen").font(.title3).fontWeight(.bold)
                Spacer()
                Button { onClose() } label: { Image(systemName: "xmark").foregroundStyle(.secondary) }
                    .buttonStyle(.plain)
            }
            .padding(.horizontal, 18).padding(.top, 16).padding(.bottom, 12)

            // Primary nav
            navItem(icon: "plus", title: "New chat") { onNewChat() }
            navItem(icon: "house", title: "Home") { onNewChat() }
            navItem(icon: "gearshape", title: "Settings") { onSettings() }

            Divider().padding(.vertical, 10).padding(.horizontal, 18)

            // Search
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Search chats", text: $query)
                    .textFieldStyle(.plain)
                if !query.isEmpty {
                    Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }
                        .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 9)
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 10))
            .padding(.horizontal, 18)

            // History
            if results.isEmpty {
                VStack {
                    Spacer()
                    Text(query.isEmpty ? "No chats yet" : "No matches")
                        .font(.subheadline).foregroundStyle(.secondary)
                    Spacer()
                }
                .frame(maxWidth: .infinity)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 2) {
                        ForEach(results) { convo in
                            Button { onOpenChat(convo) } label: {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(convo.title).lineLimit(1).foregroundStyle(.primary)
                                    Text(convo.updatedAt, style: .relative)
                                        .font(.caption2).foregroundStyle(.secondary)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.vertical, 10).padding(.horizontal, 18)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .contextMenu {
                                Button(role: .destructive) { store.delete(convo.id) } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                        }
                    }
                    .padding(.top, 8)
                }
            }
            Spacer(minLength: 0)
        }
        .background(Color(.systemBackground))
    }

    private func navItem(icon: String, title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: icon).font(.title3).frame(width: 26)
                Text(title)
                Spacer()
            }
            .foregroundStyle(.primary)
            .padding(.vertical, 11).padding(.horizontal, 18)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
