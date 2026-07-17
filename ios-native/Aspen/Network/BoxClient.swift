import Foundation

/// Talks to the user's Aspen box exactly like the existing clients do (verified
/// against mobile-native/src/api.js):
///   validate: GET  {tunnelUrl}/v1/models   (Bearer apiKey)
///   chat:     POST https://www.runonaspen.com/api/agent  { tunnelUrl, apiKey, model, messages }
///             -> SSE stream of:
///                {"choices":[{"delta":{"content":"…"}}]}     answer tokens
///                {"aspen_status":"Searching the web…","aspen_transient":bool}  activity
///                {"aspen_model":"llama4:scout"}              the routed model (footer truth)
///                {"error":"…"}                               upstream error
///                [DONE]                                      end
final class BoxClient {
    static let proxy = "https://www.runonaspen.com"

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
        let url = URL(string: "\(normalize(config.tunnelUrl))/v1/models")!
        var req = URLRequest(url: url)
        req.timeoutInterval = 8
        if !config.apiKey.isEmpty { req.setValue("Bearer \(config.apiKey)", forHTTPHeaderField: "Authorization") }
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse else { throw BoxError.badStatus(code: 0, body: "") }
        guard http.statusCode == 200 else { throw BoxError.badStatus(code: http.statusCode, body: errorBody(data)) }
        let decoded = try JSONDecoder().decode(ModelsResponse.self, from: data)
        return decoded.data.map { $0.id }
    }

    /// Stream a chat turn from the box. Callbacks fire as SSE arrives.
    /// Retries once on a fresh connection if the first attempt dies on a stale
    /// pooled socket (URLSession reuses keep-alive connections; right after the
    /// box/tunnel restarts, the reused socket is dead and the first request fails
    /// with -1005 "network connection was lost"). The retry is guarded so it only
    /// fires before any token streamed — no duplicated output mid-stream.
    static func chat(
        config: Config,
        model: String,
        messages: [ChatTurn],
        onStatus: @escaping (String) -> Void,
        onModel: @escaping (String) -> Void,
        onToken: @escaping (String) -> Void
    ) async throws {
        var tokenSeen = false
        let token: (String) -> Void = { t in tokenSeen = true; onToken(t) }
        do {
            try await performChat(config: config, model: model, messages: messages,
                                  session: .shared,
                                  onStatus: onStatus, onModel: onModel, onToken: token)
        } catch let err as URLError where !tokenSeen && isStaleConnection(err) {
            // Dead pooled socket. Open a brand-new connection (ephemeral session
            // has its own pool) and try once more. Safe: nothing streamed yet.
            let fresh = URLSession(configuration: .ephemeral)
            try await performChat(config: config, model: model, messages: messages,
                                  session: fresh,
                                  onStatus: onStatus, onModel: onModel, onToken: token)
        }
    }

    /// Connection-level failures worth one fresh-socket retry (vs. real errors
    /// like a 4xx/5xx or upstream message, which must surface).
    private static func isStaleConnection(_ err: URLError) -> Bool {
        switch err.code {
        case .networkConnectionLost, .timedOut, .cannotConnectToHost,
             .cannotFindHost, .dnsLookupFailed, .notConnectedToInternet:
            return true
        default:
            return false
        }
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
        let url = URL(string: "\(proxy)/api/agent")!
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 180   // box may cold-load a large model before the first token
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let payload = AgentRequest(
            tunnelUrl: normalize(config.tunnelUrl),
            apiKey: config.apiKey,
            model: model,
            messages: messages.map { .init(role: $0.role, content: $0.content, images: $0.images) }
        )
        req.httpBody = try JSONEncoder().encode(payload)

        let (bytes, resp) = try await session.bytes(for: req)
        guard let http = resp as? HTTPURLResponse else { throw BoxError.badStatus(code: 0, body: "") }
        guard http.statusCode == 200 else {
            // Drain the error body — this is the only place that can tell us what
            // actually went wrong (tunnel 502 vs revoked key vs gateway 500).
            var raw = Data()
            for try await b in bytes { raw.append(b); if raw.count > 600 { break } }
            throw BoxError.badStatus(code: http.statusCode, body: errorBody(raw))
        }

        for try await line in bytes.lines {
            guard line.hasPrefix("data: ") else { continue }
            let payloadStr = String(line.dropFirst(6))
            if payloadStr == "[DONE]" { break }
            guard let data = payloadStr.data(using: .utf8) else { continue }
            guard let evt = try? JSONDecoder().decode(SSEEvent.self, from: data) else { continue }
            if let err = evt.error { throw BoxError.upstream(err) }
            if let status = evt.aspen_status { onStatus(status) }
            if let m = evt.aspen_model { onModel(m) }
            if let token = evt.choices?.first?.delta?.content { onToken(token) }
        }
    }

    // MARK: wire types
    struct ModelsResponse: Codable { let data: [ModelId] }
    struct ModelId: Codable { let id: String }
    struct AgentRequest: Codable {
        let tunnelUrl: String; let apiKey: String; let model: String
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
