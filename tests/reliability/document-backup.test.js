// @vitest-environment node
import { test, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { encryptDocuments, decryptDocuments } from '../../shared/document-backup';
test('document backups authenticate bytes and reject wrong passwords, tampering and hashes', async () => {
  const text = 'My private warranty';
  const files = [{ name: 'warranty.txt', base64: Buffer.from(text).toString('base64'), sha256: createHash('sha256').update(text).digest('hex') }];
  const password = 'a private document password';
  const raw = await encryptDocuments(files, password);
  expect(raw).not.toContain(text);
  expect(await decryptDocuments(raw, password)).toEqual(files);
  await expect(decryptDocuments(raw, 'the wrong password')).rejects.toThrow('Wrong password');
  const damaged = JSON.parse(raw); damaged.nonce = Buffer.alloc(12).toString('base64');
  await expect(decryptDocuments(JSON.stringify(damaged), password)).rejects.toThrow('Wrong password');
  await expect(encryptDocuments([{ ...files[0], sha256: 'bad' }], password)).rejects.toThrow('integrity');
  await expect(encryptDocuments(files, 'short')).rejects.toThrow('12');
});
