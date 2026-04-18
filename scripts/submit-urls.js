/**
 * URL Submission Script
 * Run after every deploy: node scripts/submit-urls.js
 * Submits to IndexNow (covers Bing, Yandex, Seznam) and pings Google sitemap
 */

const https = require('https');

const SITE = 'open-llm-ten.vercel.app';
const SITE_URL = `https://${SITE}`;
const INDEXNOW_KEY = 'freellm367ebbb44c26ff6d1694ce96';

const URLS = [
  `${SITE_URL}/`,
];

async function post(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      resolve({ status: res.statusCode });
    }).on('error', reject);
  });
}

async function main() {
  console.log('Submitting URLs...\n');

  // IndexNow — covers Bing, Yandex, Seznam, DuckDuckGo (via Bing)
  try {
    const r = await post('https://api.indexnow.org/indexnow', {
      host: SITE,
      key: INDEXNOW_KEY,
      keyLocation: `${SITE_URL}/${INDEXNOW_KEY}.txt`,
      urlList: URLS,
    });
    console.log(`IndexNow (Bing network): ${r.status === 200 || r.status === 202 ? '✓' : '✗'} HTTP ${r.status}`);
  } catch (e) {
    console.log(`IndexNow: ✗ ${e.message}`);
  }

  // Bing directly
  try {
    const r = await post('https://ssl.bing.com/webmaster/api.svc/json/SubmitUrlbatch?apikey=sampleapikeyEDECC1EA4AE341CC8B6', {
      siteUrl: SITE_URL, urlList: URLS
    });
    console.log(`Bing direct: HTTP ${r.status}`);
  } catch (e) {
    console.log(`Bing direct: ${e.message}`);
  }

  // Google sitemap ping
  try {
    const r = await get(`https://www.google.com/ping?sitemap=${SITE_URL}/sitemap.xml`);
    console.log(`Google sitemap ping: HTTP ${r.status}`);
  } catch (e) {
    console.log(`Google sitemap: ${e.message}`);
  }

  console.log('\nDone. Note: Google Search Console verification must be done manually at https://search.google.com/search-console');
  console.log('Add the site and verify ownership via the HTML meta tag method.');
}

main().catch(console.error);
