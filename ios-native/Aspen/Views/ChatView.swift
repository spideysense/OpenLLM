import SwiftUI
import PhotosUI

/// The chat screen. Native streaming bubbles, an animated "thinking" indicator
/// that shows live status (tool-call narration on box mode), and a tier pill.
struct ChatView: View {
    @StateObject private var vm = ChatViewModel()
    @State private var showTier = false
    @State private var showConnect = false
    @State private var showMenu = false
    @State private var showVoice = false
    @State private var pickerItems: [PhotosPickerItem] = []
    @Namespace private var bottomID

    private var hasDraft: Bool {
        !vm.input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !vm.pendingImages.isEmpty
    }

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
        .fullScreenCover(isPresented: $showVoice) {
            VoiceModeView(vm: vm)
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
                        MessageBubble(
                            message: msg,
                            isStreaming: vm.streaming && msg.role == "assistant" && msg.id == vm.messages.last?.id,
                            boxConfig: vm.boxConfig
                        )
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
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: vm.messages.last?.content) { _, _ in
                withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(bottomID, anchor: .bottom) }
            }
        }
    }

    private var composer: some View {
        VStack(spacing: 8) {
            if !vm.pendingImages.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(Array(vm.pendingImages.enumerated()), id: \.offset) { idx, b64 in
                            if let data = Data(base64Encoded: b64), let ui = UIImage(data: data) {
                                ZStack(alignment: .topTrailing) {
                                    Image(uiImage: ui)
                                        .resizable().scaledToFill()
                                        .frame(width: 56, height: 56)
                                        .clipShape(RoundedRectangle(cornerRadius: 10))
                                    Button {
                                        vm.pendingImages.remove(at: idx)
                                    } label: {
                                        Image(systemName: "xmark.circle.fill")
                                            .font(.system(size: 16))
                                            .foregroundStyle(.white, .black.opacity(0.5))
                                    }
                                    .padding(2)
                                }
                            }
                        }
                    }
                    .padding(.horizontal)
                }
                .frame(height: 60)
            }
            HStack(spacing: 10) {
                PhotosPicker(selection: $pickerItems, maxSelectionCount: 4, matching: .images) {
                    Image(systemName: "plus")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 40, height: 44)
                }
                .onChange(of: pickerItems) { _, items in
                    guard !items.isEmpty else { return }
                    Task { await loadPicked(items) }
                }
                TextField("Message your Aspen…", text: $vm.input, axis: .vertical)
                    .lineLimit(1...5)
                    .padding(.horizontal, 16).padding(.vertical, 12)
                    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 22))
                Button {
                    if vm.streaming { vm.stop() }
                    else if hasDraft { vm.send() }
                    else { showVoice = true }
                } label: {
                    Image(systemName: vm.streaming ? "stop.fill" : (hasDraft ? "arrow.up" : "waveform"))
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
    }

    /// Load picked photos, downscale + JPEG-compress to keep the payload small
    /// (large base64 images would blow the request timeout), append as base64.
    private func loadPicked(_ items: [PhotosPickerItem]) async {
        for item in items {
            if let data = try? await item.loadTransferable(type: Data.self),
               let ui = UIImage(data: data),
               let b64 = Self.downscaledJPEGBase64(ui) {
                await MainActor.run { vm.pendingImages.append(b64) }
            }
        }
        await MainActor.run { pickerItems = [] }
    }

    private static func downscaledJPEGBase64(_ image: UIImage, maxDim: CGFloat = 1024, quality: CGFloat = 0.7) -> String? {
        let size = image.size
        guard size.width > 0, size.height > 0 else { return nil }
        let scale = min(1, maxDim / max(size.width, size.height))
        let target = CGSize(width: size.width * scale, height: size.height * scale)
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let resized = UIGraphicsImageRenderer(size: target, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
        return resized.jpegData(compressionQuality: quality)?.base64EncodedString()
    }

    private var footer: some View {
        Text(vm.footerModel)
            .font(.caption).foregroundStyle(.secondary)
            .padding(.bottom, 6)
    }
}

/// A streaming-aware chat bubble. While a turn is streaming it renders plain
/// text (zero parse cost — protects the buttery streaming speed). Once the turn
/// completes it renders rich content: markdown, code blocks, and openable
/// html/svg artifacts.
struct MessageBubble: View {
    let message: ChatTurn
    var isStreaming: Bool = false
    var boxConfig: BoxClient.Config? = nil
    var isUser: Bool { message.role == "user" }

    var body: some View {
        HStack {
            if isUser { Spacer(minLength: 40) }
            bubble
            if !isUser { Spacer(minLength: 40) }
        }
    }

    @ViewBuilder private var bubble: some View {
        if isUser {
            VStack(alignment: .trailing, spacing: 6) {
                if let imgs = message.images, !imgs.isEmpty {
                    VStack(spacing: 6) {
                        ForEach(Array(imgs.enumerated()), id: \.offset) { _, b64 in
                            if let data = Data(base64Encoded: b64), let ui = UIImage(data: data) {
                                Image(uiImage: ui)
                                    .resizable().scaledToFit()
                                    .frame(maxWidth: 220, maxHeight: 220)
                                    .clipShape(RoundedRectangle(cornerRadius: 14))
                            }
                        }
                    }
                }
                if !message.content.isEmpty {
                    Text(message.content)
                        .padding(.horizontal, 16).padding(.vertical, 11)
                        .background(AnyShapeStyle(Color(.secondarySystemBackground)), in: RoundedRectangle(cornerRadius: 20))
                        .foregroundStyle(Color.primary)
                        .textSelection(.enabled)
                }
            }
        } else if isStreaming {
            // STREAMING PATH — plain text only, never parse mid-stream.
            Text(message.content.isEmpty ? " " : message.content)
                .padding(.horizontal, 4).padding(.vertical, 4)
                .foregroundStyle(Color.primary)
                .textSelection(.enabled)
        } else {
            // COMPLETED PATH — rich render with artifacts.
            MessageContentView(content: message.content, boxConfig: boxConfig)
                .padding(.horizontal, 4).padding(.vertical, 4)
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
