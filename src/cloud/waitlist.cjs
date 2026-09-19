'use strict';
const { createHash, createHmac, randomBytes } = require('node:crypto');

const PREFIX = '{aspen:waitlist:v1}';
const MEMBERS = PREFIX + ':members';
const ORDER = PREFIX + ':order';
const CODES = PREFIX + ':codes';
const RECEIPTS = PREFIX + ':receipts';
const IDENTITIES = PREFIX + ':identities';
const BOOST = 7 * 86400000;
const identity = email => {
  let [name, domain] = email.toLowerCase().split('@');
  name = name.split('+')[0];
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') name = name.replaceAll('.', '');
  return sha(name + '@' + domain);
};
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
async function join(email, source, receipt, referral = '') {
  const id = sha(email);
  const createdAt = new Date().toISOString();
  const record = { email, source, createdAt, consentAt: createdAt, consentVersion: 'launch-early-access-v1', verified: false, receiptHash: sha(receipt), referralCode: randomBytes(12).toString('base64url'), referralCount: 0, identity: identity(email) };
  // First signup wins. Retries cannot duplicate, overwrite consent or take over
  // someone else's undo receipt. Both keys share a Redis hash slot.
  const result = await command('EVAL', `
    if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 1 then return 0 end
    local record = cjson.decode(ARGV[2])
    local parentId = redis.call('HGET', KEYS[3], ARGV[4])
    local parentValue = parentId and redis.call('HGET', KEYS[1], parentId)
    local firstIdentity = redis.call('HSETNX', KEYS[5], record.identity, ARGV[1])
    if parentValue and parentId ~= ARGV[1] and firstIdentity == 1 then
      local parent = cjson.decode(parentValue)
      if parent.identity ~= record.identity then
        record.referredBy = parent.referralCode
        parent.referralCount = (parent.referralCount or 0) + 1
        redis.call('HSET', KEYS[1], parentId, cjson.encode(parent))
        redis.call('ZINCRBY', KEYS[2], -tonumber(ARGV[5]), parentId)
      end
    end
    redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(record))
    redis.call('HSET', KEYS[3], record.referralCode, ARGV[1])
    redis.call('HSET', KEYS[4], record.receiptHash, ARGV[1])
    redis.call('ZADD', KEYS[2], ARGV[3], ARGV[1])
    return 1`, 5, MEMBERS, ORDER, CODES, RECEIPTS, IDENTITIES, id, JSON.stringify(record), Date.now(), referral, BOOST);
  if (result !== 0 && result !== 1) throw new Error('Signup was not acknowledged');
}

async function remove(email, receipt) {
  const result = await command('EVAL', `
    local value = redis.call('HGET', KEYS[1], ARGV[1])
    if not value then return 0 end
    local record = cjson.decode(value)
    if record.receiptHash ~= ARGV[2] then return 0 end
    if record.referredBy then
      local parentId = redis.call('HGET', KEYS[3], record.referredBy)
      local parentValue = parentId and redis.call('HGET', KEYS[1], parentId)
      if parentValue then
        local parent = cjson.decode(parentValue)
        if (parent.referralCount or 0) > 0 then
          parent.referralCount = parent.referralCount - 1
          redis.call('HSET', KEYS[1], parentId, cjson.encode(parent))
          redis.call('ZINCRBY', KEYS[2], ARGV[3], parentId)
        end
      end
    end
    if record.referralCode then redis.call('HDEL', KEYS[3], record.referralCode) end
    redis.call('HDEL', KEYS[4], record.receiptHash)
    if record.identity and redis.call('HGET', KEYS[5], record.identity) == ARGV[1] then
      redis.call('HDEL', KEYS[5], record.identity)
    end
    redis.call('HDEL', KEYS[1], ARGV[1])
    redis.call('ZREM', KEYS[2], ARGV[1])
    return 1`, 5, MEMBERS, ORDER, CODES, RECEIPTS, IDENTITIES, sha(email), sha(receipt), BOOST);
  if (result !== 0 && result !== 1) throw new Error('Removal was not acknowledged');
  return result === 1;
}

// The private receipt is a capability; public referral codes never authorize status.
async function status(receipt) {
  const result = await command('EVAL', `
    local id = redis.call('HGET', KEYS[3], ARGV[1])
    if not id then return '' end
    local value = redis.call('HGET', KEYS[1], id)
    if not value then return '' end
    local record = cjson.decode(value)
    if record.receiptHash ~= ARGV[1] then return '' end
    local rank = redis.call('ZRANK', KEYS[2], id)
    if not rank then return '' end
    return cjson.encode({position=rank+1, referrals=record.referralCount or 0, code=record.referralCode})
  `, 3, MEMBERS, ORDER, RECEIPTS, sha(receipt));
  if (result === '') return null;
  const data = typeof result === 'string' ? JSON.parse(result) : null;
  if (!data || !Number.isSafeInteger(data.position) || data.position < 1 || !Number.isSafeInteger(data.referrals) || data.referrals < 0 || !/^[A-Za-z0-9_-]{16}$/.test(data.code)) throw new Error('Invalid waitlist status');
  return data;
}

// Called only after the admin endpoint has checked its server-side password.
async function list(offset = 0) {
  const total = await command('ZCARD', ORDER);
  const ids = await command('ZRANGE', ORDER, offset, offset + 199);
  if (!Number.isSafeInteger(total) || !Array.isArray(ids)) throw new Error('Invalid waitlist response');
  const values = ids.length ? await command('HMGET', MEMBERS, ...ids) : [];
  if (!Array.isArray(values)) throw new Error('Invalid waitlist response');
  const contacts = values.filter(Boolean).map((value, index) => {
    const { email, source, createdAt, consentAt, consentVersion, verified } = JSON.parse(value);
    return { email, source, createdAt, consentAt, consentVersion, verified, position: offset + index + 1, referrals: JSON.parse(value).referralCount || 0 };
  });
  return { total, contacts, nextOffset: ids.length === 200 ? offset + 200 : null };
}

module.exports = { command, allowed, newReceipt, join, remove, list, status };
