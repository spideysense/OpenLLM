import { gcm } from '@noble/ciphers/aes';
import { sha256 } from '@noble/hashes/sha256';
import { getRandomBytes } from 'expo-crypto';
const enc = new TextEncoder(),
  dec = new TextDecoder();
const from64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const to64 = (b) => btoa(Array.from(b, (n) => String.fromCharCode(n)).join(''));
export async function nativeCrypto(secret) {
  const hash = (label) => sha256(enc.encode(label + secret));
  const request = hash('aspen-request-v1:'),
    response = hash('aspen-response-v1:');
  return {
    id: Array.from(hash('aspen-id-v1:'), (b) =>
      b.toString(16).padStart(2, '0')
    ).join(''),
    async seal(value) {
      const nonce = getRandomBytes(12);
      return {
        nonce: to64(nonce),
        data: to64(
          gcm(request, nonce, enc.encode('aspen-request-v1')).encrypt(
            enc.encode(JSON.stringify(value))
          )
        )
      };
    },
    async open(value, nonce) {
      return JSON.parse(
        dec.decode(
          gcm(response, from64(value.nonce), enc.encode(nonce)).decrypt(
            from64(value.data)
          )
        )
      );
    }
  };
}
