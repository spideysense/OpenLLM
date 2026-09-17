'use strict';
const { createHash, createHmac, randomBytes } = require('node:crypto');

const PREFIX = '{aspen:waitlist:v1}';
const MEMBERS = PREFIX + ':members';
const ORDER = PREFIX + ':order';
const sha = value => createHash('sha256').update(value).digest('hex');
const config = () => ({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});
async function command(...args) {
  const { url, token } = config();
  if (!url || !token) throw new Error('Waitlist storage unavailable');
  const res = await fetch(url.replace(/\/$/, ''), {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args), signal: AbortSignal.timeout(5000), cache: 'no-store',
  });
  if (!res.ok) throw new Error('Waitlist storage unavailable');
  const data = await res.json();
  if (data.error || !Object.hasOwn(data, 'result')) throw new Error('Waitlist storage unavailable');
  return data.result;
}

// Limit across serverless instances; never store the visitor's raw IP address.
async function allowed(ip, operation = 'join') {
  const { token } = config();
  if (!token) throw new Error('Waitlist storage unavailable');
  const bucket = createHmac('sha256', token).update(String(ip || 'unknown')).digest('hex');
  const n = await command('EVAL', `
    local n = redis.call('INCR', KEYS[1])
    if n == 1 then redis.call('EXPIRE', KEYS[1], 3600) end
    return n`, 1, PREFIX + ':rate:' + operation + ':' + bucket);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error('Invalid rate limit response');
  return n <= (operation === 'join' ? 3 : 10);
}

const newReceipt = () => randomBytes(32).toString('base64url');
async function join(email, source, receipt) {
  const id = sha(email);
  const createdAt = new Date().toISOString();
  const record = { email, source, createdAt, consentAt: createdAt, consentVersion: 'launch-early-access-v1', verified: false, receiptHash: sha(receipt) };
  // First signup wins. Retries cannot duplicate, overwrite consent or take over
  // someone else's undo receipt. Both keys share a Redis hash slot.
  const result = await command('EVAL', `
    if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 1 then return 0 end
    redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
    redis.call('ZADD', KEYS[2], ARGV[3], ARGV[1])
    return 1`, 2, MEMBERS, ORDER, id, JSON.stringify(record), Date.now());
  if (result !== 0 && result !== 1) throw new Error('Signup was not acknowledged');
}

async function remove(email, receipt) {
  const result = await command('EVAL', `
    local value = redis.call('HGET', KEYS[1], ARGV[1])
    if not value then return 0 end
    local record = cjson.decode(value)
    if record.receiptHash ~= ARGV[2] then return 0 end
    redis.call('HDEL', KEYS[1], ARGV[1])
    redis.call('ZREM', KEYS[2], ARGV[1])
    return 1`, 2, MEMBERS, ORDER, sha(email), sha(receipt));
  if (result !== 0 && result !== 1) throw new Error('Removal was not acknowledged');
  return result === 1;
}

// Called only after the admin endpoint has checked its server-side password.
async function list(offset = 0) {
  const total = await command('ZCARD', ORDER);
  const ids = await command('ZREVRANGE', ORDER, offset, offset + 199);
  if (!Number.isSafeInteger(total) || !Array.isArray(ids)) throw new Error('Invalid waitlist response');
  const values = ids.length ? await command('HMGET', MEMBERS, ...ids) : [];
  if (!Array.isArray(values)) throw new Error('Invalid waitlist response');
  const contacts = values.filter(Boolean).map(value => {
    const { email, source, createdAt, consentAt, consentVersion, verified } = JSON.parse(value);
    return { email, source, createdAt, consentAt, consentVersion, verified };
  });
  return { total, contacts, nextOffset: ids.length === 200 ? offset + 200 : null };
}

module.exports = { command, allowed, newReceipt, join, remove, list };
