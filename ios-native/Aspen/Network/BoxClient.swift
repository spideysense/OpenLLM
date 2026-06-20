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
        guard let http = resp as? HTTPURLResponse, http.statusCode == 200 else { throw BoxError.badStatus }
        let decoded = try JSONDecoder().decode(ModelsResponse.self, from: data)
        return decoded.data.map { $0.id }
    }

    /// Stream a chat turn from the box. Callbacks fire as SSE arrives.
    static func chat(
        config: Config,
        model: String,
        messages: [ChatTurn],
        onStatus: @escaping (String) -> Void,
        onModel: @escaping (String) -> Void,
        onToken: @escaping (String) -> Void
    ) async throws {
        let url = URL(string: "\(proxy)/api/agent")!
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let payload = AgentRequest(
            tunnelUrl: normalize(config.tunnelUrl),
            apiKey: config.apiKey,
            model: model,
            messages: messages.map { .init(role: $0.role, content: $0.content) }
        )
        req.httpBody = try JSONEncoder().encode(payload)

        let (bytes, resp) = try await URLSession.shared.bytes(for: req)
        guard let http = resp as? HTTPURLResponse, http.statusCode == 200 else { throw BoxError.badStatus }

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
        struct Msg: Codable { let role: String; let content: String }
    }
    struct SSEEvent: Codable {
        let choices: [Choice]?
        let aspen_status: String?
        let aspen_model: String?
        let error: String?
        struct Choice: Codable { let delta: Delta? }
        struct Delta: Codable { let content: String? }
    }
    enum BoxError: Error { case badStatus, upstream(String) }
}
