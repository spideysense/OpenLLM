const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parsePairing } = require('../src/pairing.cjs');
test('setup cards parse only supported Aspen addresses and credentials', () => {
  const token = 'setup-aspen-' + 'x'.repeat(43);
  const code = (address, prefix = 'aspen://pair') => `${prefix}#tunnel=${encodeURIComponent(address)}&setup=${token}`;
  assert.equal(parsePairing(code('http://aspen-012345abcdef.local:4001')).apiKey, token);
  assert.equal(parsePairing(code('https://home.runonaspen.com')).tunnelUrl, 'https://home.runonaspen.com');
  for (const address of ['http://outside.example', 'https://user:password@outside.example', 'https://home.runonaspen.com/extra', 'http://aspen-012345abcdef.local:1234']) assert.throws(() => parsePairing(code(address)));
  assert.throws(() => parsePairing(code('https://example.com', 'https://outside.example')));
});
