const json = (res, code, value) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
};
async function body(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 6 * 1024 * 1024) throw new Error('Request too large');
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
}
async function handle(req, res) {
  if (!['/v1/vault', '/v1/context', '/v1/household'].includes(req.url)) return false;
  if (!req.aspenSecure) {
    json(res, 403, { error: 'Use the encrypted Aspen transport for household data' });
    return true;
  }
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const vault = require('./vault').get();
    if (req.url === '/v1/context') {
      if (req.method !== 'POST') {
        json(res, 405, { error: 'POST required' });
        return true;
      }
      const input = await body(req);
      json(res, 200, vault.context(token, input.query));
      return true;
    }
    const keys = require('./apikeys');
    const key = keys.listKeys().find((k) => k.secret === token);
    if (!key) {
      json(res, 401, { error: 'Invalid pairing' });
      return true;
    }
    const person = key.owner ? 'owner' : key.userId || key.id;
    const input = req.method === 'GET' ? { action: 'list' } : await body(req);
    // Authentication may change while a slow request body is being received.
    if (!keys.validateKey(token)) throw new Error('Pairing revoked');
    if (req.url === '/v1/household') {
      if (!key.owner) {
        json(res, 403, { error: 'Owner access required' });
        return true;
      }
      let value;
      if (req.method === 'GET')
        value = {
          people: keys.listKeys().map(({ secret, ...k }) => k),
          model: require('./store').get('activeModel') || null,
          storage: vault.status(),
          modelStatus: require('./store').get('applianceModelStatus') || null,
          enrollment: require('./enrollment').status(),
          localAddress: require('./enrollment').status() ? `http://aspen-${require('./enrollment').status().deviceId}.local:4001` : null,
        };
      else if (input.action === 'retry-model') value = require('./service').retryModel();
      else if (input.action === 'invite') {
        if (
          typeof input.label !== 'string' ||
          !input.label.trim() ||
          input.label.length > 100 ||
          keys.listKeys().length >= 32
        )
          throw new Error('Use a name up to 100 characters; maximum 32 paired devices');
        value = keys.createKey(input.label.trim(), { memory: input.memory === true });
      } else if (input.action === 'revoke') {
        const target = keys.listKeys().find((k) => k.id === input.id);
        if (!target || target.owner) throw new Error('Use the desktop to manage owner credentials');
        value = keys.revokeKey(input.id);
      } else throw new Error('Unsupported household action');
      json(res, 200, value);
      return true;
    }
    if (!['GET', 'POST'].includes(req.method)) {
      json(res, 405, { error: 'Unsupported method' });
      return true;
    }
    let result;
    switch (input.action) {
      case 'list':
        result = {
          documents: vault.list(person),
          grants: vault.grants(person),
          activity: vault.activity(person),
          status: vault.status(),
          person,
          people: keys
            .listKeys()
            .map((k) => ({
              id: k.id,
              userId: k.owner ? 'owner' : k.userId || k.id,
              label: k.label,
            })),
        };
        break;
      case 'import':
        result = await vault.ingest(person, input, () => keys.validateKey(token));
        break;
      case 'search':
        result = vault.search(person, input.query);
        break;
      case 'download':
        result = vault.download(person, input.id);
        break;
      case 'update':
        result = vault.update(person, input.id, input);
        break;
      case 'delete':
        result = vault.remove(person, input.id);
        break;
      case 'grant':
        result = vault.grant(person, input);
        break;
      case 'revoke':
        result = vault.revoke(person, input.id);
        break;
      default:
        throw new Error('Unsupported vault action');
    }
    if (!keys.validateKey(token)) throw new Error('Pairing revoked');
    json(res, 200, result);
  } catch (error) {
    json(res, 400, { error: error.message });
  }
  return true;
}
module.exports = { handle };
