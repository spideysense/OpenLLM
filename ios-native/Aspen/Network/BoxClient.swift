import Foundation
import CryptoKit

/// Uses an authenticated encrypted channel directly to the paired household box.
/// Plaintext SSE is decoded only after response authentication on this device.
final class BoxClient {
    struct Config: Codable, Equatable {
        var tunnelUrl: String
        var apiKey: String
    }

    static func normalize(_ u: String) -> String {
        var s = u.trimmingCharacters(in: .whitespacesAndNewlines)
        while s.hasSuffix("/") { s.removeLast() }
        if s.hasSuffix("/v1") { s.removeLast(3) }
        return s
    }

    /// Validate a box and return its model ids.
    static func fetchModels(_ config: Config) async throws -> [String] {
        let data = try await secureData(config, path: "/v1/models")
        let decoded = try JSONDecoder().decode(ModelsResponse.self, from: data)
        return decoded.data.map { $0.id }
    }

    /// Stream one chat turn. Interrupted requests surface to the user for review.
    static func chat(
        config: Config,
        model: String,
        messages: [ChatTurn],
        onStatus: @escaping (String) -> Void,
        onModel: @escaping (String) -> Void,
        onToken: @escaping (String) -> Void
    ) async throws {
        // An interrupted agent request may already have changed files or sent a
        // tool request. Do not automatically repeat it without server idempotency.
        try await performChat(config: config, model: model, messages: messages,
                              session: .shared,
                              onStatus: onStatus, onModel: onModel, onToken: onToken)
    }

    private static func performChat(
        config: Config,
        model: String,
        messages: [ChatTurn],
        session: URLSession,
        onStatus: @escaping (String) -> Void,
        onModel: @escaping (String) -> Void,
        onToken: @escaping (String) -> Void
    ) async throws {
        let payload = AgentRequest(model: model, messages: messages.map { .init(role: $0.role, content: $0.content, images: $0.images) })
        var buffer = Data()
        for try await chunk in secureBytes(config, path: "/v1/agent", method: "POST", body: try JSONEncoder().encode(payload), session: session) {
            buffer.append(chunk)
            while let newline = buffer.firstIndex(of: 10) {
                let line = String(decoding: buffer[..<newline], as: UTF8.self)
                buffer.removeSubrange(...newline)
                guard line.hasPrefix("data: ") else { continue }
                let raw = String(line.dropFirst(6))
                if raw == "[DONE]" { continue }
                let evt = try JSONDecoder().decode(SSEEvent.self, from: Data(raw.utf8))
                if let err = evt.error { throw BoxError.upstream(err) }
                if let status = evt.aspen_status { onStatus(status) }
                if let m = evt.aspen_model { onModel(m) }
                if let token = evt.choices?.first?.delta?.content { onToken(token) }
            }
        }
    }

    static func secureData(_ config: Config, path: String, method: String = "GET", body: Data? = nil) async throws -> Data {
        var data = Data()
        for try await chunk in secureBytes(config, path: path, method: method, body: body) { data.append(chunk) }
        return data
    }
    static func secureBytes(_ config: Config, path: String, method: String = "GET", body: Data? = nil, session: URLSession = .shared) -> AsyncThrowingStream<Data, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    var payload: [String: Any] = ["method": method, "path": path, "time": Date().timeIntervalSince1970 * 1000]
                    if let body { payload["body"] = try JSONSerialization.jsonObject(with: body) }
                    let sealed = try SecureCodec.seal(JSONSerialization.data(withJSONObject: payload), secret: config.apiKey)
                    let nonce = sealed.nonce
                    let cipher = sealed.data
                    let id = SecureCodec.id(config.apiKey)
                    guard let url = URL(string: "\(normalize(config.tunnelUrl))/v1/secure"), ["http", "https"].contains(url.scheme ?? "") else { throw URLError(.badURL) }
                    var request = URLRequest(url: url); request.httpMethod = "POST"; request.timeoutInterval = 180
                    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    request.httpBody = try JSONSerialization.data(withJSONObject: ["id": id, "nonce": nonce, "data": cipher])
                    let (bytes, response) = try await session.bytes(for: request)
                    guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw BoxError.upstream("Secure connection failed. Update Aspen on your box and check the pairing.") }
                    var expected = 0; var completed = false
                    for try await line in bytes.lines {
                        try Task.checkCancellation()
                        if line.isEmpty { continue }
                        guard line.utf8.count <= 12 * 1024 * 1024 else { throw URLError(.dataLengthExceedsMaximum) }
                        let envelope = try JSONDecoder().decode(SecureCodec.Envelope.self, from: Data(line.utf8))
                        let raw = try SecureCodec.open(envelope, secret: config.apiKey, requestNonce: nonce)
                        let frame = try JSONDecoder().decode(SecureFrame.self, from: raw)
                        guard frame.sequence == expected else { throw URLError(.cannotDecodeContentData) }; expected += 1
                        if let status = frame.status, status >= 400 { throw BoxError.badStatus(code: status, body: "Aspen rejected this request") }
                        if let text = frame.bytes, let data = Data(base64Encoded: text) { continuation.yield(data) }
                        if frame.end == true { completed = true; break }
                    }
                    guard completed else { throw URLError(.networkConnectionLost) }
                    continuation.finish()
                } catch { continuation.finish(throwing: error) }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
    private struct SecureFrame: Codable { let sequence: Int; let status: Int?; let bytes: String?; let end: Bool? }

    // MARK: wire types
    struct ModelsResponse: Codable { let data: [ModelId] }
    struct ModelId: Codable { let id: String }
    struct AgentRequest: Codable {
        let model: String
        let messages: [Msg]
        struct Msg: Codable { let role: String; let content: String; let images: [String]? }
    }
    struct SSEEvent: Codable {
        let choices: [Choice]?
        let aspen_status: String?
        let aspen_model: String?
        let error: String?
        struct Choice: Codable { let delta: Delta? }
        struct Delta: Codable { let content: String? }
    }
    /// Carries the HTTP status and any body the box sent back. The old
    /// `case badStatus` threw both away, so a failure surfaced as the useless
    /// "Aspen.BoxClient.BoxError error 0" with nothing to diagnose from.
    enum BoxError: LocalizedError {
        case badStatus(code: Int, body: String)
        case upstream(String)

        var errorDescription: String? {
            switch self {
            case .upstream(let msg):
                return msg
            case .badStatus(let code, let body):
                let detail = body.trimmingCharacters(in: .whitespacesAndNewlines)
                let hint: String
                switch code {
                case 401, 403:
                    hint = "Your Aspen rejected this device's key. Re-pair by scanning the QR on your Aspen."
                case 404:
                    hint = "Your Aspen answered, but not on the expected address. Check the URL, or re-pair with the QR."
                case 429:
                    hint = "Your Aspen is rate limiting this device. Give it a moment and try again."
                case 502, 503, 504:
                    hint = "The secure tunnel reached Cloudflare but couldn't get to your Aspen. Check the machine is awake and Aspen is running."
                case 500...599:
                    hint = "Your Aspen hit an error handling this (\(code))."
                default:
                    hint = "Your Aspen returned HTTP \(code)."
                }
                return detail.isEmpty ? hint : "\(hint)\n\n\(detail.prefix(300))"
            }
        }
    }

    /// Read a small slice of an error body — enough to diagnose, not enough to
    /// dump a whole HTML error page into a chat bubble.
    private static func errorBody(_ data: Data) -> String {
        String(data: data.prefix(600), encoding: .utf8) ?? ""
    }
}
