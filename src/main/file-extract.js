// ═══════════════════════════════════════════════════
// file-extract.js — turn a binary document into plain text
// ═══════════════════════════════════════════════════
// Runs in the Electron MAIN process (the renderer is sandboxed and can't use
// these Node libraries). The renderer sends file bytes (base64) + name over IPC;
// we route by extension and return extracted text. Everything stays local — the
// file never leaves the machine, matching Aspen's privacy model.

const MAX_CHARS = 100000; // cap so we don't blow the model's context window

function ext(name) {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

// base64 (no data: prefix) -> Buffer
function toBuffer(base64) {
  return Buffer.from(base64, 'base64');
}

async function extractPdf(buf) {
  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const res = await parser.getText();
    return (res?.text || '').trim();
  } finally {
    try { await parser.destroy(); } catch {}
  }
}

async function extractDocx(buf) {
  const mammoth = require('mammoth');
  const res = await mammoth.extractRawText({ buffer: buf });
  return (res?.value || '').trim();
}

function extractXlsx(buf) {
  const XLSX = require('xlsx');
  const wb = XLSX.read(buf, { type: 'buffer' });
  const parts = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    if (csv.trim()) parts.push(`# Sheet: ${sheetName}\n${csv}`);
  }
  return parts.join('\n\n').trim();
}

// Main entry: { name, base64 } -> { ok, text } | { ok:false, error }
async function extractText({ name, base64 }) {
  const e = ext(name);
  if (!base64) return { ok: false, error: 'No file data.' };
  let buf;
  try { buf = toBuffer(base64); } catch { return { ok: false, error: 'Could not decode file.' }; }
  try {
    let text = '';
    if (e === 'pdf') text = await extractPdf(buf);
    else if (e === 'docx') text = await extractDocx(buf);
    else if (e === 'xlsx' || e === 'xls') text = extractXlsx(buf);
    else {
      // plain-text-ish fallback (txt/md/csv/code) — just decode as UTF-8.
      text = buf.toString('utf8');
    }
    if (!text) return { ok: false, error: `No readable text found in this ${e || 'file'}.` };
    let truncated = false;
    if (text.length > MAX_CHARS) { text = text.slice(0, MAX_CHARS); truncated = true; }
    return { ok: true, text, truncated };
  } catch (err) {
    return { ok: false, error: `Could not read ${e || 'file'}: ${err.message}` };
  }
}

module.exports = { extractText };
