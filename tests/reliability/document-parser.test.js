// @vitest-environment node
import { it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const { extract } = require('../../src/main/extract-worker');
function spreadsheet() { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Item','Amount'], ['Furnace filter',73]]), 'Home'); return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }); }
it('parses real spreadsheet content in the isolated worker and rejects an archive with excessive expansion', async () => {
  const bytes = spreadsheet();
  const result = await extract({ name: 'home.xlsx', base64: bytes.toString('base64') });
  expect(result.ok).toBe(true); expect(result.text).toContain('Furnace filter,73');
  const bomb = Buffer.from(bytes), central = bomb.indexOf(Buffer.from('504b0102', 'hex'));
  expect(central).toBeGreaterThan(0); bomb.writeUInt32LE(40 * 1024 * 1024, central + 24);
  const rejected = await extract({ name: 'oversized.xlsx', base64: bomb.toString('base64') });
  expect(rejected.ok).toBe(false); expect(rejected.error).toMatch(/limits|size/i);
});
it('bounds text extraction while preserving visible truncation and reports malformed PDF data', async () => {
  const result = await extract({ name: 'long.txt', base64: Buffer.from('a'.repeat(100001)).toString('base64') });
  expect(result.text.length).toBe(100000); expect(result.truncated).toBe(true);
  const pdf = await extract({ name: 'broken.pdf', base64: Buffer.from('not a PDF').toString('base64') });
  expect(pdf.ok).toBe(false); expect(pdf.error).toContain('Could not read pdf');
});
