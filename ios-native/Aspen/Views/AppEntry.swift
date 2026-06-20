import SwiftUI

/// First run: download the on-device model once, then chat. No account, no box.
struct OnboardingView: View {
    var onReady: () -> Void
    @ObservedObject private var engine = LocalEngine.shared
    @State private var downloading = false
    @State private var error = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer()
            Text("ASPEN").font(.caption).fontWeight(.bold).foregroundStyle(.secondary).tracking(2)
            Text("Private AI, right on your iPhone.")
                .font(.system(size: 30, weight: .bold)).padding(.top, 20)
            Text("Nothing leaves your device. Works offline. No account.")
                .font(.body).foregroundStyle(.secondary).padding(.top, 10)
            Spacer()

            if downloading {
                VStack(spacing: 12) {
                    ProgressView(value: engine.loadProgress)
                    Text("Downloading model · \(Int(engine.loadProgress * 100))%")
                        .font(.subheadline).foregroundStyle(.secondary)
                    Text("One time, ~2 GB. Keep the app open.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            } else {
                Button {
                    Task { await download() }
                } label: {
                    Text("Set up on-device AI")
                        .fontWeight(.semibold).foregroundStyle(.white)
                        .frame(maxWidth: .infinity).padding(.vertical, 16)
                        .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 16))
                }
                .buttonStyle(.plain)
                Text("Runs entirely on your iPhone. Connect your Aspen on a Mac later for bigger models.")
                    .font(.caption).foregroundStyle(.secondary)
                    .multilineTextAlignment(.center).frame(maxWidth: .infinity).padding(.top, 12)
                if !error.isEmpty { Text(error).font(.caption).foregroundStyle(.red).padding(.top, 8) }
            }
        }
        .padding(28)
    }

    private func download() async {
        downloading = true; error = ""
        do {
            try await engine.loadIfNeeded()
            let h = UINotificationFeedbackGenerator(); h.notificationOccurred(.success)
            onReady()
        } catch {
            self.error = "Download failed. Check your connection and try again."
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
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 12) {
            Capsule().fill(.secondary.opacity(0.3)).frame(width: 38, height: 4).padding(.top, 8)
            Text("Where should Aspen run?").font(.headline).frame(maxWidth: .infinity, alignment: .leading)

            row(title: "On iPhone", sub: "Llama 3.2 · instant, private, offline", active: tier == .local, action: onPickLocal)
            row(title: "On your Aspen",
                sub: boxConnected ? "Connected · the big models" : "Connect your Mac or Aspen box",
                active: tier == .box, action: onPickBox)
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
