import SwiftUI

/// Connect to the user's Aspen box (Mac/appliance). Validates the tunnel URL +
/// key via BoxClient.fetchModels, then hands the config back so chat can switch
/// to box mode. Reached from the tier sheet's "On your Aspen" when not connected.
struct ConnectView: View {
    var onConnected: (BoxClient.Config, [String]) -> Void
    var onCancel: () -> Void

    @State private var url = ""
    @State private var key = ""
    @State private var connecting = false
    @State private var error = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Button("Cancel", action: onCancel)
                Spacer()
            }
            .padding(.bottom, 24)

            Text("Connect your Aspen").font(.system(size: 26, weight: .bold))
            Text("Run the big models on your own Mac or Aspen box. Your messages go only to your machine.")
                .font(.subheadline).foregroundStyle(.secondary).padding(.top, 8)

            VStack(spacing: 12) {
                TextField("Address (e.g. https://xxxx.runonaspen.com)", text: $url)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .keyboardType(.URL)
                    .padding(14).background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
                SecureField("API key", text: $key)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .padding(14).background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
            }
            .padding(.top, 28)

            if !error.isEmpty {
                Text(error).font(.caption).foregroundStyle(.red).padding(.top, 10)
            }

            Button {
                Task { await connect() }
            } label: {
                HStack {
                    if connecting { ProgressView().tint(.white) }
                    Text(connecting ? "Connecting…" : "Connect").fontWeight(.semibold)
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity).padding(.vertical, 15)
                .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 14))
            }
            .buttonStyle(.plain)
            .disabled(connecting || url.isEmpty)
            .opacity(url.isEmpty ? 0.5 : 1)
            .padding(.top, 20)

            Spacer()
            Text("🔒 Nothing routes through our servers. The connection goes straight to your machine.")
                .font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
        }
        .padding(24)
    }

    private func connect() async {
        connecting = true; error = ""
        let cfg = BoxClient.Config(tunnelUrl: url, apiKey: key)
        do {
            let models = try await BoxClient.fetchModels(cfg)
            let h = UINotificationFeedbackGenerator(); h.notificationOccurred(.success)
            onConnected(cfg, models)
        } catch {
            self.error = "Couldn't reach that box. Check the address and key."
            connecting = false
        }
    }
}
