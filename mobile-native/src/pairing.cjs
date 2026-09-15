function parsePairing(text) {
  if (typeof text !== 'string' || text.length > 4096) throw new Error('Invalid Aspen code');
  const url = new URL(text);
  if (!((url.protocol === 'aspen:' && url.hostname === 'pair') || (url.protocol === 'https:' && ['runonaspen.com', 'www.runonaspen.com'].includes(url.hostname)))) throw new Error('Not an Aspen pairing code');
  const params = new URLSearchParams(url.hash.slice(1));
  const address = params.get('tunnel'), credential = params.get('key') || params.get('setup');
  const base = new URL(address);
  if (base.username || base.password || base.search || base.hash || !['', '/'].includes(base.pathname)) throw new Error('Invalid Aspen address');
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && /^aspen-[a-f0-9]{12}\.local$/.test(base.hostname) && base.port === '4001')) throw new Error('Use a secure address or your Aspen home-network name');
  if (!/^(sk|setup|recovery)-aspen-[A-Za-z0-9_-]{32,64}$/.test(credential || '')) throw new Error('Invalid pairing credential');
  return { tunnelUrl: base.origin, apiKey: credential };
}
module.exports = { parsePairing };
