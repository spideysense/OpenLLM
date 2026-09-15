// Browser/React Native transport. No bearer token or plaintext payload is sent.
// cryptoAdapter is injectable for native runtimes; browsers use WebCrypto.
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const to64 = (bytes) =>
  btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
const from64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
async function browserCrypto(secret) {
  const hash = async (label) =>
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', encoder.encode(label + secret))
    );
  const request = await crypto.subtle.importKey(
    'raw',
    await hash('aspen-request-v1:'),
    'AES-GCM',
    false,
    ['encrypt']
  );
  const response = await crypto.subtle.importKey(
    'raw',
    await hash('aspen-response-v1:'),
    'AES-GCM',
    false,
    ['decrypt']
  );
  return {
    id: Array.from(await hash('aspen-id-v1:'), (b) =>
      b.toString(16).padStart(2, '0')
    ).join(''),
    async seal(value) {
      const nonce = crypto.getRandomValues(new Uint8Array(12));
      return {
        nonce: to64(nonce),
        data: to64(
          new Uint8Array(
            await crypto.subtle.encrypt(
              {
                name: 'AES-GCM',
                iv: nonce,
                additionalData: encoder.encode('aspen-request-v1')
              },
              request,
              encoder.encode(JSON.stringify(value))
            )
          )
        )
      };
    },
    async open(value, nonce) {
      return JSON.parse(
        decoder.decode(
          await crypto.subtle.decrypt(
            {
              name: 'AES-GCM',
              iv: from64(value.nonce),
              additionalData: encoder.encode(nonce)
            },
            response,
            from64(value.data)
          )
        )
      );
    }
  };
}
export async function secureFetch(
  base,
  secret,
  path,
  {
    method = 'GET',
    body,
    signal,
    fetchImpl = fetch,
    cryptoAdapter = browserCrypto
  } = {}
) {
  if (!secret) throw new Error('Pair this device with an Aspen key first.');
  const cipher = await cryptoAdapter(secret);
  const envelope = await cipher.seal({ method, path, body, time: Date.now() });
  const response = await fetchImpl(
    base.replace(/\/v1\/?$/, '').replace(/\/+$/, '') + '/v1/secure',
    {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: cipher.id, ...envelope })
    }
  );
  if (!response.ok || !response.body)
    throw new Error(
      'Secure connection failed. Update Aspen on the box and check the pairing.'
    );
  const reader = response.body.getReader();
  const textDecoder = new TextDecoder();
  let buffer = '',
    sequence = 0,
    completed = false;
  const pending = [];
  async function next() {
    while (!pending.length) {
      const chunk = await reader.read();
      if (chunk.done) {
        if (!completed) throw new Error('Secure response interrupted.');
        return null;
      }
      buffer += textDecoder.decode(chunk.value, { stream: true });
      if (buffer.length > 16 * 1024 * 1024) throw new Error('Secure response frame is too large');
      const lines = buffer.split('\n');
      buffer = lines.pop();
      pending.push(...lines.filter(Boolean));
    }
    const frame = await cipher.open(
      JSON.parse(pending.shift()),
      envelope.nonce
    );
    if (frame.sequence !== sequence++)
      throw new Error('Invalid secure response sequence');
    if (frame.end) completed = true;
    return frame;
  }
  let first;
  try {
    first = await next();
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        if (completed) {
          controller.close();
          return;
        }
        const frame = await next();
        if (frame?.bytes) controller.enqueue(from64(frame.bytes));
        if (!frame || frame.end) controller.close();
      } catch (e) {
        await reader.cancel().catch(() => {});
        controller.error(e);
      }
    },
    cancel: () => reader.cancel()
  });
  return new Response(stream, {
    status: first?.status || 200,
    headers: { 'Content-Type': 'text/event-stream' }
  });
}
