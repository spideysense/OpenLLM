const encoder = new TextEncoder(), decoder = new TextDecoder();
const to64 = bytes => {
  let text = ''; for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(text);
};
const from64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
async function key(password, salt) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) throw new Error('Use a password of 12–1,024 characters.');
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600000 }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function validate(files) {
  if (!Array.isArray(files) || files.length > 1000) throw new Error('Invalid document backup');
  let total = 0;
  for (const file of files) {
    if (typeof file.name !== 'string' || !file.name.trim() || file.name.length > 200 || typeof file.base64 !== 'string' || file.base64.length > 5592408) throw new Error('Invalid document');
    const bytes = from64(file.base64); total += bytes.length;
    if (!bytes.length || bytes.length > 4 * 1024 * 1024 || total > 256 * 1024 * 1024) throw new Error('Document backup exceeds vault limits');
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const sha = Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
    if (sha !== file.sha256) throw new Error('Document integrity check failed');
  }
  return files;
}
export async function encryptDocuments(files, password) {
  await validate(files);
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode('aspen-documents-v1') }, await key(password, salt), encoder.encode(JSON.stringify({ files })));
  return JSON.stringify({ format: 'aspen-documents-v1', salt: to64(salt), nonce: to64(iv), data: to64(new Uint8Array(data)) });
}
export async function decryptDocuments(raw, password) {
  if (typeof raw !== 'string' || raw.length > 512 * 1024 * 1024) throw new Error('Backup is too large');
  const envelope = JSON.parse(raw);
  if (envelope.format !== 'aspen-documents-v1') throw new Error('Choose an Aspen document backup');
  const salt = from64(envelope.salt), iv = from64(envelope.nonce);
  if (salt.length !== 16 || iv.length !== 12) throw new Error('Invalid backup');
  let plaintext;
  try { plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode('aspen-documents-v1') }, await key(password, salt), from64(envelope.data)); }
  catch { throw new Error('Wrong password or damaged backup'); }
  return validate(JSON.parse(decoder.decode(plaintext)).files);
}
