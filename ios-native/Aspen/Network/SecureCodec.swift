import Foundation
import CryptoKit

/// Wire codec shared by the native client and cross-language fixture tests.
enum SecureCodec {
    struct Envelope: Codable { let nonce: String; let data: String }
    static func key(_ secret: String, label: String) -> Data {
        Data(SHA256.hash(data: Data((label + secret).utf8)))
    }
    static func id(_ secret: String) -> String {
        key(secret, label: "aspen-id-v1:").map { String(format: "%02x", $0) }.joined()
    }
    static func seal(_ data: Data, secret: String, nonce: Data? = nil) throws -> Envelope {
        let iv = try nonce.map { try AES.GCM.Nonce(data: $0) } ?? AES.GCM.Nonce()
        let box = try AES.GCM.seal(data, using: SymmetricKey(data: key(secret, label: "aspen-request-v1:")), nonce: iv, authenticating: Data("aspen-request-v1".utf8))
        return Envelope(nonce: Data(box.nonce).base64EncodedString(), data: (box.ciphertext + box.tag).base64EncodedString())
    }
    static func open(_ envelope: Envelope, secret: String, requestNonce: String) throws -> Data {
        guard let iv = Data(base64Encoded: envelope.nonce), iv.count == 12,
              let encrypted = Data(base64Encoded: envelope.data), encrypted.count >= 16 else { throw URLError(.cannotDecodeContentData) }
        let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: iv), ciphertext: encrypted.dropLast(16), tag: encrypted.suffix(16))
        return try AES.GCM.open(box, using: SymmetricKey(data: key(secret, label: "aspen-response-v1:")), authenticating: Data(requestNonce.utf8))
    }
}
