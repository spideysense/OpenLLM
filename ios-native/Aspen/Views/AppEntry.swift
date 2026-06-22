import SwiftUI

/// First-run onboarding. Walks the user through what Aspen is, the two ways to
/// use it (on-device + connect your Mac/box), and the key benefits — then
/// downloads the on-device model. Native paging with smooth transitions.
struct OnboardingView: View {
    var onReady: () -> Void
    @ObservedObject private var engine = LocalEngine.shared
    @State private var page = 0
    @State private var downloading = false
    @State private var error = ""

    var body: some View {
        VStack(spacing: 0) {
            TabView(selection: $page) {
                welcome.tag(0)
                twoWays.tag(1)
                features.tag(2)
                setup.tag(3)
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .animation(.easeInOut, value: page)

            dots
            controls
        }
        .padding(.bottom, 28)
    }

    // MARK: pages

    private var welcome: some View {
        page(
            badge: "ASPEN",
            title: "Private AI, right on your iPhone.",
            body: "A real AI assistant that runs on your own device. Nothing leaves your phone — no account, no cloud, works offline.",
            icon: "iphone.gen3"
        )
    }

    private var twoWays: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer()
            Text("TWO WAYS TO USE ASPEN").font(.caption).fontWeight(.bold).foregroundStyle(.secondary).tracking(1.5)
            Text("Instant on your phone.\nPowerful on your Mac.").font(.system(size: 28, weight: .bold)).padding(.top, 16)

            VStack(spacing: 16) {
                infoRow(icon: "iphone.gen3", title: "On your iPhone",
                        sub: "A fast on-device model. Instant, private, works on a plane. Great for everyday questions, writing, and quick help.")
                infoRow(icon: "desktopcomputer", title: "Connect your Aspen",
                        sub: "Link to your Mac or Aspen box to run much larger models for serious coding and research — still 100% private to your own machine.")
            }
            .padding(.top, 28)
            Spacer(); Spacer()
        }
        .padding(.horizontal, 28)
    }

    private var features: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer()
            Text("WHAT YOU GET").font(.caption).fontWeight(.bold).foregroundStyle(.secondary).tracking(1.5)
            Text("Yours. Private. Always on.").font(.system(size: 28, weight: .bold)).padding(.top, 16)

            VStack(spacing: 18) {
                infoRow(icon: "lock.fill", title: "Truly private",
                        sub: "Your conversations never leave your devices. No servers, no training on your data.")
                infoRow(icon: "wifi.slash", title: "Works offline",
                        sub: "The on-device model runs with no internet at all.")
                infoRow(icon: "brain", title: "It remembers",
                        sub: "Aspen learns what matters to you over time — stored only on your machine.")
            }
            .padding(.top, 24)
            Spacer(); Spacer()
        }
        .padding(.horizontal, 28)
    }

    private var setup: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer()
            Text("ALMOST THERE").font(.caption).fontWeight(.bold).foregroundStyle(.secondary).tracking(1.5)
            Text("Set up on-device AI").font(.system(size: 28, weight: .bold)).padding(.top, 16)
            Text("We'll download a compact AI model to your iPhone — about 2 GB, one time. After this it runs instantly and offline. Best on Wi-Fi.")
                .font(.body).foregroundStyle(.secondary).padding(.top, 12)
            Spacer()
            if downloading {
                VStack(spacing: 12) {
                    ProgressView(value: engine.loadProgress)
                    Text("Downloading model · \(Int(engine.loadProgress * 100))%")
                        .font(.subheadline).foregroundStyle(.secondary)
                    Text("Keep the app open.").font(.caption).foregroundStyle(.secondary)
                }
                .padding(.bottom, 20)
            } else if !error.isEmpty {
                Text(error).font(.caption).foregroundStyle(.red).padding(.bottom, 12)
            }
            Spacer()
        }
        .padding(.horizontal, 28)
    }

    // MARK: chrome

    private var dots: some View {
        HStack(spacing: 8) {
            ForEach(0..<4) { i in
                Circle().fill(i == page ? Color.primary : Color.secondary.opacity(0.3))
                    .frame(width: 7, height: 7)
            }
        }
        .padding(.bottom, 20)
    }

    private var controls: some View {
        Group {
            if page < 3 {
                Button { withAnimation { page += 1 } } label: {
                    Text("Continue").fontWeight(.semibold).foregroundStyle(.white)
                        .frame(maxWidth: .infinity).padding(.vertical, 16)
                        .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 16))
                }.buttonStyle(.plain)
            } else {
                Button { Task { await download() } } label: {
                    Text(downloading ? "Downloading…" : "Download & start")
                        .fontWeight(.semibold).foregroundStyle(.white)
                        .frame(maxWidth: .infinity).padding(.vertical, 16)
                        .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 16))
                }.buttonStyle(.plain).disabled(downloading)
            }
        }
        .padding(.horizontal, 28)
    }

    // MARK: helpers

    private func page(badge: String, title: String, body: String, icon: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer()
            Image(systemName: icon).font(.system(size: 52)).foregroundStyle(Color.accentColor).padding(.bottom, 28)
            Text(badge).font(.caption).fontWeight(.bold).foregroundStyle(.secondary).tracking(2)
            Text(title).font(.system(size: 30, weight: .bold)).padding(.top, 16)
            Text(body).font(.body).foregroundStyle(.secondary).padding(.top, 12)
            Spacer(); Spacer()
        }
        .padding(.horizontal, 28)
    }

    private func infoRow(icon: String, title: String, sub: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: icon).font(.title2).foregroundStyle(Color.accentColor).frame(width: 30)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.headline)
                Text(sub).font(.subheadline).foregroundStyle(.secondary)
            }
        }
    }

    private func download() async {
        // Preflight: if the device can't safely hold the model, don't even try —
        // attempting the load lets iOS jetsam-kill the app (the crash on a
        // memory-tight iPhone 15). Show a clear reason instead.
        guard DeviceCompat.canRunDefaultModel else {
            self.error = DeviceCompat.incompatibilityReason
            return
        }
        downloading = true; error = ""
        do {
            try await engine.loadIfNeeded()
            let h = UINotificationFeedbackGenerator(); h.notificationOccurred(.success)
            onReady()
        } catch {
            // Surface the real reason instead of a generic line. Low storage is the
            // most common cause of a failure near the end of the ~2GB download.
            let ns = error as NSError
            let msg = ns.localizedDescription
            if ns.code == NSFileWriteOutOfSpaceError || msg.lowercased().contains("space") {
                self.error = "Not enough free storage. The model needs about 2 GB free — clear some space and try again."
            } else if msg.lowercased().contains("network") || msg.lowercased().contains("internet") || msg.lowercased().contains("connection") {
                self.error = "Network interrupted the download. Stay on Wi-Fi and tap Retry — it resumes where it left off."
            } else {
                self.error = "Download failed: \(msg). Tap Retry — it resumes where it left off."
            }
            downloading = false
        }
    }
}

/// Pick where Aspen runs.
struct TierSheet: View {
    let tier: Tier
    let boxConnected: Bool
    var onPickLocal: () -> Void
    var onPickBox: () -> Void
    var onChangeConnection: () -> Void
    var onDisconnect: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 12) {
            Capsule().fill(.secondary.opacity(0.3)).frame(width: 38, height: 4).padding(.top, 8)
            Text("Where should Aspen run?").font(.headline).frame(maxWidth: .infinity, alignment: .leading)

            row(title: "On iPhone", sub: "Llama 3.2 · instant, private, offline", active: tier == .local, action: onPickLocal)
            row(title: "On your Aspen",
                sub: boxConnected ? "Connected · the big models" : "Connect your Mac or Aspen box",
                active: tier == .box, action: onPickBox)

            // When a box is connected, let the user change the URL/key or drop it.
            if boxConnected {
                HStack(spacing: 10) {
                    Button(action: onChangeConnection) {
                        Label("Change connection", systemImage: "arrow.triangle.2.circlepath")
                            .font(.subheadline.weight(.medium))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
                    }
                    Button(role: .destructive, action: onDisconnect) {
                        Label("Disconnect", systemImage: "xmark.circle")
                            .font(.subheadline.weight(.medium))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
                    }
                    .foregroundStyle(.red)
                }
                .buttonStyle(.plain)
                .padding(.top, 2)
            }
            Spacer()
        }
        .padding(.horizontal, 18)
    }

    private func row(title: String, sub: String, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).fontWeight(.semibold)
                    Text(sub).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if active { Image(systemName: "checkmark").foregroundStyle(Color.accentColor) }
            }
            .padding(16)
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(active ? Color.accentColor : .clear, lineWidth: 1.5))
        }
        .buttonStyle(.plain).foregroundStyle(.primary)
    }
}

@main
struct AspenApp: App {
    @AppStorage("onboarded") private var onboarded = false

    var body: some Scene {
        WindowGroup {
            if onboarded {
                ChatView()
            } else {
                OnboardingView { onboarded = true }
            }
        }
    }
}
