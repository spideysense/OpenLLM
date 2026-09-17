const { allowed, join, newReceipt, remove } = require('../src/cloud/waitlist.cjs');

const ORIGINS = new Set(['https://runonaspen.com', 'https://www.runonaspen.com']);
const emailPattern = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+$/i;
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!['POST', 'DELETE'].includes(req.method)) {
    res.setHeader('Allow', 'POST, DELETE');
    return res.status(405).json({ error: 'Use the waitlist form to join.' });
  }
  if (!ORIGINS.has(req.headers.origin)) return res.status(403).json({ error: 'Please join from runonaspen.com.' });
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return res.status(415).json({ error: 'Please use the waitlist form.' });
  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
  if (!body || Array.isArray(body) || typeof body !== 'object' || JSON.stringify(body).length > 2048) return res.status(400).json({ error: 'Please check the form and try again.' });
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email.length > 254 || !emailPattern.test(email) || email.split('@')[0].length > 64 || email.includes('..') || email.startsWith('.') || email.includes('.@')) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (req.method === 'POST' && body.consent !== true) return res.status(400).json({ error: 'Please agree to receive Aspen launch and early access emails.' });
  if (req.method === 'DELETE' && (typeof body.receipt !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.receipt))) return res.status(400).json({ error: 'The signup receipt is missing.' });
  const receipt = newReceipt();
  if (req.method === 'POST' && body.website) return res.status(200).json({ ok: true, receipt });
  try {
    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    if (!await allowed(ip, req.method === 'POST' ? 'join' : 'undo')) {
      res.setHeader('Retry-After', '3600');
      return res.status(429).json({ error: 'A few requests have come from this connection. Please try again in an hour.' });
    }
    if (req.method === 'DELETE') return res.status(200).json({ ok: true, removed: await remove(email, body.receipt) });
    const source = typeof body.source === 'string' ? body.source.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 60) || 'direct' : 'direct';
    await join(email, source, receipt);
    // Same response for new/existing addresses. This is capture only: it does
    // not claim mailbox verification or send any email.
    return res.status(200).json({ ok: true, receipt });
  } catch {
    // Never show a success screen for a failed write, or expose provider errors.
    return res.status(503).json({ error: 'We couldn’t save your signup just now. Please try again in a moment.' });
  }
}
