import Foundation

@main struct VerifyCrypto {
    static func main() throws {
        let raw = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
        let fixture = try JSONSerialization.jsonObject(with: raw) as! [String: Any]
        let secret = fixture["secret"] as! String
        precondition(SecureCodec.id(secret) == fixture["id"] as! String)
        let nonce = Data(base64Encoded: fixture["nonce"] as! String)!
        let payload = Data(base64Encoded: fixture["payload"] as! String)!
        let sealed = try SecureCodec.seal(payload, secret: secret, nonce: nonce)
        precondition(sealed.data == fixture["encryptedRequest"] as! String)
        let response = SecureCodec.Envelope(nonce: fixture["responseNonce"] as! String, data: fixture["encryptedResponse"] as! String)
        let opened = try SecureCodec.open(response, secret: secret, requestNonce: sealed.nonce)
        precondition(opened == Data(base64Encoded: fixture["response"] as! String)!)
        do { _ = try SecureCodec.open(response, secret: secret, requestNonce: "wrong-request"); fatalError("Cross-request replay accepted") } catch {}
        do { _ = try SecureCodec.open(response, secret: "wrong-key", requestNonce: sealed.nonce); fatalError("Wrong key accepted") } catch {}
        print("Native CryptoKit / Node interoperability passed")
    }
}
