const crypto = require('crypto');
const fs = require('fs');
// Public test secret; never used as an application or signing credential.
const secret = 'aspen-public-interoperability-fixture';
const derive = label => crypto.createHash('sha256').update(label + secret).digest();
const nonce = Buffer.from('000102030405060708090a0b', 'hex');
const responseNonce = Buffer.from('101112131415161718191a1b', 'hex');
const payload = Buffer.from(JSON.stringify({ method: 'POST', path: '/v1/agent', body: { text: '家🌲' }, time: 12345 }));
const response = Buffer.from(JSON.stringify({ sequence: 0, status: 200, end: true }));
function seal(key, iv, data, aad) { const c = crypto.createCipheriv('aes-256-gcm', key, iv); c.setAAD(Buffer.from(aad)); return Buffer.concat([c.update(data), c.final(), c.getAuthTag()]).toString('base64'); }
fs.writeFileSync(process.argv[2], JSON.stringify({ secret, id: derive('aspen-id-v1:').toString('hex'), nonce: nonce.toString('base64'), payload: payload.toString('base64'), encryptedRequest: seal(derive('aspen-request-v1:'), nonce, payload, 'aspen-request-v1'), responseNonce: responseNonce.toString('base64'), response: response.toString('base64'), encryptedResponse: seal(derive('aspen-response-v1:'), responseNonce, response, nonce.toString('base64')) }));
