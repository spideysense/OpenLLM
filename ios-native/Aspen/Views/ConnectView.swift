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
    @State private var showScanner = false
    @State private var name = ""
    @State private var pending: Enrollment?
    @State private var recoverySaved = false
    private var isSetup: Bool { key.hasPrefix("setup-aspen-") || key.hasPrefix("recovery-aspen-") }
    private struct Enrollment: Decodable { let id: String; let credential: String; let recovery: String }

    var body: some View {
        ScrollView { VStack(alignment: .leading, spacing: 0) {
            HStack {
                Button("Cancel", action: onCancel)
                Spacer()
            }
            .padding(.bottom, 24)

            Text("Connect your Aspen").font(.system(size: 26, weight: .bold))
            Text("Run the big models on your own Mac or Aspen box. Your messages go only to your machine.")
                .font(.subheadline).foregroundStyle(.secondary).padding(.top, 8)

            Button {
                showScanner = true
            } label: {
                HStack {
                    Image(systemName: "qrcode.viewfinder")
                    Text("Scan QR code").fontWeight(.semibold)
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity).padding(.vertical, 15)
                .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 14))
            }
            .buttonStyle(.plain)
            .padding(.top, 24)

            HStack { Rectangle().fill(Color(.separator)).frame(height: 1); Text("or enter manually").font(.caption).foregroundStyle(.secondary).fixedSize(); Rectangle().fill(Color(.separator)).frame(height: 1) }
                .padding(.top, 20)

            VStack(spacing: 12) {
                TextField("Address (e.g. https://xxxx.runonaspen.com)", text: $url)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .keyboardType(.URL)
                    .padding(14).background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
                SecureField("Pairing, setup, or recovery code", text: $key)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .padding(14).background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
            }
            .padding(.top, 28)
            .disabled(pending != nil)

            if isSetup && pending == nil {
                TextField("Your name", text: $name).textContentType(.givenName)
                    .padding(14).background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
            }
            if let pending {
                Text("Save your recovery code").font(.headline).padding(.top, 16)
                Text("Keep it in your password manager or a safe place. Anyone with it can restore owner access. Finishing setup replaces previous owner device credentials; family members and their data stay in place.").font(.caption)
                Text(pending.recovery).font(.system(.caption, design: .monospaced)).textSelection(.enabled).padding(.vertical, 12)
                ShareLink("Save recovery code", item: "Aspen recovery code: \(pending.recovery)\nKeep this private.")
                Toggle("I saved my recovery code", isOn: $recoverySaved)
            }

            if !error.isEmpty {
                Text(error).font(.caption).foregroundStyle(.red).padding(.top, 10)
            }

            Button {
                Task { await connect() }
            } label: {
                HStack {
                    if connecting { ProgressView().tint(.white) }
                    Text(connecting ? "Connecting…" : pending != nil ? "Finish setup" : isSetup ? "Set up Aspen" : "Connect").fontWeight(.semibold)
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity).padding(.vertical, 15)
                .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 14))
            }
            .buttonStyle(.plain)
            .disabled(connecting || url.isEmpty || key.isEmpty || (isSetup && name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) || (pending != nil && !recoverySaved))
            .opacity(url.isEmpty ? 0.5 : 1)
            .padding(.top, 20)

            Spacer()
            Text("🔒 Nothing routes through our servers. The connection goes straight to your machine.")
                .font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
        } }
        .padding(24)
        .sheet(isPresented: $showScanner) {
            QRScannerView(
                onScan: { scanned in showScanner = false; handleScan(scanned) },
                onCancel: { showScanner = false }
            )
            .ignoresSafeArea()
            .overlay(alignment: .top) {
                Button("Cancel") { showScanner = false }
                    .padding(12).background(.ultraThinMaterial, in: Capsule()).padding(.top, 50)
            }
        }
    }

    /// Parse a pairing URL of the form https://runonaspen.com/app#tunnel=<enc>&key=<enc>
    private func handleScan(_ s: String) {
        guard s.count <= 4096, let scanned = URL(string: s),
              (scanned.scheme == "aspen" && scanned.host == "pair") ||
              (scanned.scheme == "https" && ["runonaspen.com", "www.runonaspen.com"].contains(scanned.host ?? "")) else {
            error = "That QR code isn’t an Aspen pairing code."
            return
        }
        guard let hashIdx = s.firstIndex(of: "#") else {
            error = "That QR code isn’t an Aspen pairing code."
            return
        }
        let frag = String(s[s.index(after: hashIdx)...])
        var t: String?
        var k = ""
        for pair in frag.split(separator: "&") {
            let kv = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            guard kv.count == 2 else { continue }
            let name = String(kv[0])
            let val = String(kv[1]).removingPercentEncoding ?? String(kv[1])
            if name == "tunnel" { t = val }
            if name == "key" || name == "setup" { k = val }
        }
        guard let tunnel = t, !tunnel.isEmpty else {
            error = "That QR code isn’t an Aspen pairing code."
            return
        }
        url = tunnel
        key = k
        pending = nil; recoverySaved = false
        if !k.hasPrefix("setup-aspen-") && !k.hasPrefix("recovery-aspen-") { Task { await connect() } }
    }

    private func connect() async {
        connecting = true; error = ""
        let cfg = BoxClient.Config(tunnelUrl: url, apiKey: key)
        do {
            if isSetup {
                if let pending {
                    let activated = BoxClient.Config(tunnelUrl: url, apiKey: pending.credential)
                    guard BoxCredentials.save(try JSONEncoder().encode(activated)) else { throw BoxClient.BoxError.upstream("Unlock this phone to save your connection securely.") }
                    do {
                        _ = try await BoxClient.secureData(cfg, path: "/v1/enroll", method: "POST", body: JSONSerialization.data(withJSONObject: ["action": "confirm", "id": pending.id]))
                    } catch {
                        // Confirmation may have committed before the connection dropped.
                        _ = try await BoxClient.secureData(activated, path: "/v1/vault")
                    }
                    onConnected(activated, [])
                } else {
                    let data = try await BoxClient.secureData(cfg, path: "/v1/enroll", method: "POST", body: JSONSerialization.data(withJSONObject: ["action": "prepare", "label": name]))
                    pending = try JSONDecoder().decode(Enrollment.self, from: data)
                }
                connecting = false
                return
            }
            let models = try await BoxClient.fetchModels(cfg)
            let h = UINotificationFeedbackGenerator(); h.notificationOccurred(.success)
            onConnected(cfg, models)
        } catch {
            self.error = "Couldn't connect or complete setup. Check the code and that your phone and Aspen use the same home network. If setup expired, scan the card again."
            connecting = false
        }
    }
}
