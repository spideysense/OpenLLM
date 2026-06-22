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
        ZStack(alignment: .leading) {
            VStack(spacing: 0) {
                header
                Divider().opacity(0.5)
                messageList
                composer
                footer
            }
            .background(Color(.systemBackground))
            .disabled(showMenu)

            if showMenu {
                Color.black.opacity(0.35).ignoresSafeArea()
                    .onTapGesture { withAnimation(.easeInOut(duration: 0.25)) { showMenu = false } }
                    .transition(.opacity)
                SideNav(
                    tier: vm.tier,
                    boxConnected: vm.boxConfig != nil,
                    onNewChat: { vm.newChat(); close() },
                    onOpenChat: { vm.load($0); close() },
                    onSettings: { close(); showTier = true },
                    onClose: { close() }
                )
                .frame(width: 300)
                .transition(.move(edge: .leading))
                .shadow(radius: 12)
            }
        }
        .sheet(isPresented: $showTier) {
            TierSheet(
                tier: vm.tier,
                boxConnected: vm.boxConfig != nil,
                onPickLocal: { vm.setTier(.local); showTier = false },
                onPickBox: {
                    showTier = false
                    if vm.boxConfig != nil { vm.setTier(.box) } else { showConnect = true }
                },
                onChangeConnection: { showTier = false; showConnect = true },
                onDisconnect: { vm.disconnect(); showTier = false }
            )
            .presentationDetents([.height(vm.boxConfig != nil ? 360 : 280)])
        }
        .sheet(isPresented: $showConnect) {
            ConnectView(
                onConnected: { cfg, models in vm.connected(cfg, models); showConnect = false },
                onCancel: { showConnect = false }
            )
        }
    }

    private func close() { withAnimation(.easeInOut(duration: 0.25)) { showMenu = false } }

    private var header: some View {
        HStack {
            Button { withAnimation(.easeInOut(duration: 0.25)) { showMenu = true } } label: {
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
                Image(systemName: "plus").font(.title2).foregroundStyle(.primary)
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
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(Color(.systemBackground))
                    .frame(width: 44, height: 44)
                    .background(vm.streaming ? Color.red : Color.accentColor, in: RoundedRectangle(cornerRadius: 16))
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
