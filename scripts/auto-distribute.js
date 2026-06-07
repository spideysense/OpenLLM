#!/usr/bin/env node
/**
 * Aspen Auto-Distribution — posts content to social platforms automatically.
 *
 * Runs after marketing-engine.js generates content. Handles:
 * 1. Twitter/X — auto-post the daily tweet
 * 2. Dev.to — cross-post blog articles (great for SEO backlinks)
 * 3. Reddit — find relevant threads and generate draft responses (queued, not auto-posted)
 *
 * Env vars:
 * - TWITTER_BEARER_TOKEN, TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET
 * - DEVTO_API_KEY
 * - REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const MARKETING_DIR = path.join(__dirname, '..', 'marketing');
const QUEUE_DIR = path.join(MARKETING_DIR, 'queue');
const REDDIT_DIR = path.join(MARKETING_DIR, 'reddit-drafts');
const BLOG_DIR = path.join(__dirname, '..', 'site', 'blog');
const POSTED_LOG = path.join(MARKETING_DIR, 'distribution-log.json');

function getLog() { try { return JSON.parse(fs.readFileSync(POSTED_LOG, 'utf8')); } catch { return { twitter: [], devto: [], reddit: [] }; } }
function saveLog(log) { fs.writeFileSync(POSTED_LOG, JSON.stringify(log, null, 2)); }

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' } }, (res) => {
      let data = ''; res.on('data', c => data += c); res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

function httpsGet(hostname, path, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method: 'GET', headers }, (res) => {
      let data = ''; res.on('data', c => data += c); res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

// ═══════════════════════════════════════════════════
// TWITTER — OAuth 1.0a tweet posting
// ═══════════════════════════════════════════════════

function oauthSign(method, url, params, consumerSecret, tokenSecret) {
  const base = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(
    Object.keys(params).sort().map(k => `${k}=${encodeURIComponent(params[k])}`).join('&')
  )}`;
  const key = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;
  return crypto.createHmac('sha1', key).update(base).digest('base64');
}

async function postTweet(text) {
  const apiKey = process.env.TWITTER_API_KEY;
  const apiSecret = process.env.TWITTER_API_SECRET;
  const accessToken = process.env.TWITTER_ACCESS_TOKEN;
  const accessSecret = process.env.TWITTER_ACCESS_SECRET;
  if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
    console.log('  ⏭️ Twitter: skipped (no API keys)');
    return false;
  }

  const url = 'https://api.twitter.com/2/tweets';
  const oauthParams = {
    oauth_consumer_key: apiKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: accessToken,
    oauth_version: '1.0',
  };
  oauthParams.oauth_signature = oauthSign('POST', url, oauthParams, apiSecret, accessSecret);
  const authHeader = 'OAuth ' + Object.keys(oauthParams).sort().map(k => `${k}="${encodeURIComponent(oauthParams[k])}"`).join(', ');

  try {
    const res = await httpsPost('api.twitter.com', '/2/tweets', { Authorization: authHeader }, { text });
    if (res.status === 201) { console.log('  ✅ Twitter: posted'); return true; }
    console.log(`  ❌ Twitter: ${res.status} — ${res.body.slice(0, 200)}`);
    return false;
  } catch (e) { console.log(`  ❌ Twitter: ${e.message}`); return false; }
}

// ═══════════════════════════════════════════════════
// DEV.TO — cross-post blog articles
// ═══════════════════════════════════════════════════

async function postToDevto(title, markdown, canonicalUrl) {
  const apiKey = process.env.DEVTO_API_KEY;
  if (!apiKey) { console.log('  ⏭️ Dev.to: skipped (no API key)'); return false; }

  try {
    const res = await httpsPost('dev.to', '/api/articles', { 'api-key': apiKey }, {
      article: {
        title,
        body_markdown: markdown + `\n\n---\n*Originally published at [runonaspen.com](${canonicalUrl})*`,
        published: true,
        tags: ['ai', 'privacy', 'opensource', 'productivity'],
        canonical_url: canonicalUrl,
      }
    });
    if (res.status === 201) { console.log('  ✅ Dev.to: published'); return true; }
    console.log(`  ❌ Dev.to: ${res.status} — ${res.body.slice(0, 200)}`);
    return false;
  } catch (e) { console.log(`  ❌ Dev.to: ${e.message}`); return false; }
}

// ═══════════════════════════════════════════════════
// REDDIT — find relevant threads (draft responses only)
// ═══════════════════════════════════════════════════

async function getRedditToken() {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  const user = process.env.REDDIT_USERNAME;
  const pass = process.env.REDDIT_PASSWORD;
  if (!id || !secret || !user || !pass) return null;

  const auth = Buffer.from(`${id}:${secret}`).toString('base64');
  const body = `grant_type=password&username=${user}&password=${pass}`;
  const res = await httpsPost('www.reddit.com', '/api/v1/access_token',
    { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Aspen-Bot/1.0' }, body);
  return JSON.parse(res.body).access_token;
}

async function findRedditThreads() {
  const token = await getRedditToken();
  if (!token) { console.log('  ⏭️ Reddit: skipped (no API keys)'); return; }

  const subreddits = ['LocalLLaMA', 'selfhosted', 'privacy', 'artificial', 'ChatGPT', 'degoogle'];
  const keywords = ['local AI', 'run AI locally', 'private AI', 'AI privacy', 'local LLM', 'self-hosted AI', 'ChatGPT alternative', 'free AI'];

  fs.mkdirSync(REDDIT_DIR, { recursive: true });
  const dateStr = new Date().toISOString().split('T')[0];
  const drafts = [];

  for (const sub of subreddits) {
    try {
      const res = await httpsGet('oauth.reddit.com', `/r/${sub}/new.json?limit=10`,
        { Authorization: `Bearer ${token}`, 'User-Agent': 'Aspen-Bot/1.0' });
      const posts = JSON.parse(res.body).data?.children || [];

      for (const post of posts) {
        const title = post.data.title.toLowerCase();
        const selftext = (post.data.selftext || '').toLowerCase();
        const combined = title + ' ' + selftext;

        if (keywords.some(kw => combined.includes(kw.toLowerCase()))) {
          drafts.push({
            subreddit: sub,
            title: post.data.title,
            url: `https://reddit.com${post.data.permalink}`,
            created: new Date(post.data.created_utc * 1000).toISOString(),
          });
        }
      }
    } catch {}
  }

  if (drafts.length > 0) {
    const outFile = path.join(REDDIT_DIR, `${dateStr}-threads.json`);
    fs.writeFileSync(outFile, JSON.stringify(drafts, null, 2));
    console.log(`  📋 Reddit: found ${drafts.length} relevant threads → ${outFile}`);
  } else {
    console.log('  📋 Reddit: no relevant threads found today');
  }
}

// ═══════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════

async function main() {
  console.log('=== Aspen Auto-Distribution ===\n');
  const dateStr = new Date().toISOString().split('T')[0];
  const log = getLog();

  // 1. Post today's tweet
  if (!log.twitter.includes(dateStr)) {
    const socialFile = path.join(QUEUE_DIR, `${dateStr}-social.md`);
    if (fs.existsSync(socialFile)) {
      const content = fs.readFileSync(socialFile, 'utf8');
      const tweetMatch = content.match(/TWITTER:\n([\s\S]*?)(?:\n\nLINKEDIN:|\n\nTIKTOK:|$)/);
      if (tweetMatch) {
        const tweet = tweetMatch[1].trim();
        if (await postTweet(tweet)) { log.twitter.push(dateStr); }
      }
    } else { console.log('  ⏭️ Twitter: no social post for today'); }
  } else { console.log('  ⏭️ Twitter: already posted today'); }

  // 2. Cross-post today's blog to Dev.to
  if (!log.devto.includes(dateStr)) {
    const mdFiles = fs.readdirSync(BLOG_DIR).filter(f => f.startsWith(dateStr) && f.endsWith('.md'));
    if (mdFiles.length > 0) {
      const md = fs.readFileSync(path.join(BLOG_DIR, mdFiles[0]), 'utf8');
      const title = md.match(/^# (.+)$/m)?.[1] || 'Aspen Blog';
      const slug = mdFiles[0].replace('.md', '').replace(/^\d{4}-\d{2}-\d{2}-/, '');
      const canonical = `https://runonaspen.com/blog/${slug}.html`;
      if (await postToDevto(title, md, canonical)) { log.devto.push(dateStr); }
    } else { console.log('  ⏭️ Dev.to: no blog post for today'); }
  } else { console.log('  ⏭️ Dev.to: already posted today'); }

  // 3. Find relevant Reddit threads
  await findRedditThreads();

  saveLog(log);
  console.log('\n✅ Distribution complete');
}

main().catch(e => { console.error('Distribution failed:', e.message); process.exit(1); });
