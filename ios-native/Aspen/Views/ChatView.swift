import SwiftUI

/// The chat screen. Native streaming bubbles, an animated "thinking" indicator
/// that shows live status (tool-call narration on box mode), and a tier pill.
struct ChatView: View {
    @StateObject private var vm = ChatViewModel()
    @State private var showTier = false
    @State private var showConnect = false
    @State private var showMenu = false
    @Namespace private var bottomID

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().opacity(0.5)
            messageList
            composer
            footer
        }
        .background(Color(.systemBackground))
        .sheet(isPresented: $showTier) {
            TierSheet(
                tier: vm.tier,
                boxConnected: vm.boxConfig != nil,
                onPickLocal: { vm.setTier(.local); showTier = false },
                onPickBox: {
                    showTier = false
                    if vm.boxConfig != nil { vm.setTier(.box) } else { showConnect = true }
                }
            )
            .presentationDetents([.height(280)])
        }
        .sheet(isPresented: $showConnect) {
            ConnectView(
                onConnected: { cfg, models in vm.connected(cfg, models); showConnect = false },
                onCancel: { showConnect = false }
            )
        }
        .sheet(isPresented: $showMenu) {
            MenuSheet(
                tier: vm.tier,
                boxConnected: vm.boxConfig != nil,
                onNewChat: { vm.newChat(); showMenu = false },
                onChangeTier: { showMenu = false; showTier = true },
                onDisconnect: {
                    vm.boxConfig = nil; vm.boxModel = ""
                    UserDefaults.standard.removeObject(forKey: "boxModel")
                    vm.setTier(.local); showMenu = false
                }
            )
            .presentationDetents([.height(300)])
        }
    }

    private var header: some View {
        HStack {
            Button { showMenu = true } label: {
                Image(systemName: "line.3.horizontal").font(.title3).foregroundStyle(.primary)
            }
            .buttonStyle(.plain)
            Spacer()
            Button { showTier = true } label: {
                HStack(spacing: 4) {
                    Text(vm.tier == .box ? "On your Aspen" : "On iPhone").fontWeight(.semibold)
                    Image(systemName: "chevron.down").font(.caption2)
                }
                .font(.subheadline)
                .padding(.horizontal, 12).padding(.vertical, 6)
                .background(Color(.secondarySystemBackground), in: Capsule())
            }
            .buttonStyle(.plain)
            Spacer()
            Button {
                vm.newChat()
                let h = UIImpactFeedbackGenerator(style: .light); h.impactOccurred()
            } label: {
                Image(systemName: "square.and.pencil").font(.title3).foregroundStyle(.primary)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal).padding(.vertical, 10)
    }

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    ForEach(vm.messages) { msg in
                        MessageBubble(message: msg)
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                    if vm.streaming && !vm.status.isEmpty {
                        ThinkingIndicator(status: vm.status)
                    }
                    Color.clear.frame(height: 1).id(bottomID)
                }
                .padding()
                .animation(.spring(response: 0.35, dampingFraction: 0.8), value: vm.messages)
            }
            .onChange(of: vm.messages.last?.content) { _, _ in
                withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(bottomID, anchor: .bottom) }
            }
        }
    }

    private var composer: some View {
        HStack(spacing: 10) {
            TextField("Message your Aspen…", text: $vm.input, axis: .vertical)
                .lineLimit(1...5)
                .padding(.horizontal, 16).padding(.vertical, 12)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 22))
            Button {
                vm.streaming ? vm.stop() : vm.send()
            } label: {
                Image(systemName: vm.streaming ? "stop.fill" : "arrow.up")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(vm.streaming ? Color.red : Color.primary, in: RoundedRectangle(cornerRadius: 16))
            }
            .buttonStyle(.plain)
            .sensoryFeedback(.impact(weight: .light), trigger: vm.streaming)
        }
        .padding(.horizontal).padding(.vertical, 8)
    }

    private var footer: some View {
        Text(vm.footerModel)
            .font(.caption).foregroundStyle(.secondary)
            .padding(.bottom, 6)
    }
}

/// A streaming-aware chat bubble.
struct MessageBubble: View {
    let message: ChatTurn
    var isUser: Bool { message.role == "user" }

    var body: some View {
        HStack {
            if isUser { Spacer(minLength: 40) }
            Text(message.content.isEmpty && !isUser ? " " : message.content)
                .padding(.horizontal, 16).padding(.vertical, 11)
                .background(
                    isUser ? AnyShapeStyle(Color.primary) : AnyShapeStyle(Color(.secondarySystemBackground)),
                    in: RoundedRectangle(cornerRadius: 20)
                )
                .foregroundStyle(isUser ? Color(.systemBackground) : Color.primary)
                .textSelection(.enabled)
            if !isUser { Spacer(minLength: 40) }
        }
    }
}

/// Animated thinking / tool-call status. Shows the live status text from the box
/// (e.g. "Searching the web…") so the wait feels intentional, not frozen.
struct ThinkingIndicator: View {
    let status: String
    @State private var pulse = false

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "sparkle")
                .symbolEffect(.variableColor.iterative, options: .repeating)
            Text(status)
                .font(.subheadline).foregroundStyle(.secondary)
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16))
        .transition(.opacity)
    }
}

/// The burger menu — new chat, where Aspen runs, and disconnect.
struct MenuSheet: View {
    let tier: Tier
    let boxConnected: Bool
    var onNewChat: () -> Void
    var onChangeTier: () -> Void
    var onDisconnect: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Capsule().fill(.secondary.opacity(0.3)).frame(width: 38, height: 4).padding(.top, 8).padding(.bottom, 12)
            Text("Aspen").font(.headline).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 18)

            VStack(spacing: 2) {
                menuRow(icon: "square.and.pencil", title: "New chat", action: onNewChat)
                menuRow(icon: tier == .box ? "desktopcomputer" : "iphone.gen3",
                        title: "Where Aspen runs", sub: tier == .box ? "On your Aspen" : "On iPhone",
                        action: onChangeTier)
                if boxConnected {
                    menuRow(icon: "wifi.slash", title: "Disconnect Aspen", tint: .red, action: onDisconnect)
                }
            }
            .padding(.top, 12)
            Spacer()
        }
    }

    private func menuRow(icon: String, title: String, sub: String? = nil, tint: Color = .primary, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: icon).font(.title3).foregroundStyle(tint).frame(width: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).foregroundStyle(tint)
                    if let sub { Text(sub).font(.caption).foregroundStyle(.secondary) }
                }
                Spacer()
            }
            .padding(.vertical, 12).padding(.horizontal, 18)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
