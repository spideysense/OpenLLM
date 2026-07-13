/**
 * Local tools for Aspen.
 *
 * CORE PRINCIPLE: every tool runs HERE — in the user's Electron process, on the
 * user's machine, using the user's own network. Nothing touches Aspen servers.
 * The local LLM decides which (if any) tool to call; this module just executes.
 *
 * Each tool = { definition (OpenAI function schema), run(args) -> string }.
 */

const https = require('https');
const http = require('http');
const dns = require('dns');
const net = require('net');

// ── SSRF guard ───────────────────────────────────────────────────────────────
// fetch_url and web_search fetch attacker-influenceable URLs — any valid key,
// including the lower-trust family/guest keys, can call fetch_url with an
// arbitrary URL over the public tunnel. Without this guard those tools could be
// pointed at the loopback interface, the local network, or the cloud metadata
// endpoint (169.254.169.254) and return internal responses to a remote caller.
// We block any URL whose host is — or resolves to — a private, loopback,
// link-local, or otherwise reserved address, and we re-check on every redirect
// hop and pin the validated address at connect time so DNS rebinding can't slip
// past the check.
function ipIsBlocked(ip) {
  if (!ip) return true;
  let v = ip;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(v); // IPv4-mapped IPv6
  if (mapped) v = mapped[1];
  if (net.isIPv4(v)) {
    const [a, b] = v.split('.').map(Number);
    if (a === 0 || a === 127) return true;                 // this-host / loopback
    if (a === 10) return true;                             // private
    if (a === 172 && b >= 16 && b <= 31) return true;      // private
    if (a === 192 && b === 168) return true;               // private
    if (a === 169 && b === 254) return true;               // link-local + cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true;     // CGNAT
    if (a === 192 && b === 0) return true;                 // IETF protocol assignments
    if (a === 198 && (b === 18 || b === 19)) return true;  // benchmarking
    if (a >= 224) return true;                             // multicast + reserved
    return false;
  }
  if (net.isIPv6(v)) {
    const low = v.toLowerCase();
    if (low === '::1' || low === '::') return true;        // loopback / unspecified
    if (low.startsWith('fe80')) return true;               // link-local
    if (low.startsWith('fc') || low.startsWith('fd')) return true; // unique-local fc00::/7
    return false;
  }
  return true; // not a recognizable IP literal → treat as blocked
}

function hostIsBlocked(hostname) {
  let h = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1); // bracketed IPv6
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === 'metadata.google.internal') return true;
  if (net.isIP(h)) return ipIsBlocked(h); // literal IP host
  return false; // hostname — validated again at lookup time
}

// Custom DNS lookup that rejects if ANY resolved address is blocked. Passed to
// http(s).get so the address we validated is the address the socket connects to
// (closes the resolve-then-connect rebinding window).
function safeLookup(hostname, options, callback) {
  const cb = typeof options === 'function' ? options : callback;
  const opts = typeof options === 'function' ? {} : (options || {});
  dns.lookup(hostname, { ...opts, all: true }, (err, addresses) => {
    if (err) return cb(err);
    const list = Array.isArray(addresses) ? addresses : [addresses];
    for (const a of list) {
      if (ipIsBlocked(a.address)) return cb(new Error('blocked address (private/loopback/link-local)'));
    }
    if (opts.all) return cb(null, list);
    return cb(null, list[0].address, list[0].family);
  });
}

// ── helper: fetch a URL (follows simple redirects), returns text ──
function fetchText(url, { timeoutMs = 8000, maxBytes = 200000 } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch { return reject(new Error('bad url')); }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return reject(new Error('unsupported protocol'));
    }
    if (hostIsBlocked(parsed.hostname)) return reject(new Error('blocked host (private/internal address)'));
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.get(url, {
      lookup: safeLookup,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    }, (res) => {
      // follow one level of redirect
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).toString();
        return resolve(fetchText(next, { timeoutMs, maxBytes }));
      }
      let data = '';
      res.on('data', (c) => {
        data += c;
        if (data.length > maxBytes) { req.destroy(); resolve(data); }
      });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// strip tags → readable text
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ═══════════════════════════════════════════════════
// TOOL: web_search — runs from the box's own IP (private, no third-party key)
// ═══════════════════════════════════════════════════

// Self-hosted SearXNG instance (private metasearch on the box). Empty unless
// the operator sets SEARXNG_URL (e.g. http://127.0.0.1:8888).
const SEARXNG_URL = (process.env.SEARXNG_URL || '').replace(/\/+$/, '');

// Query SearXNG's JSON API. Returns [{title, snippet, link}] (max 6) or [] on any
// failure (unconfigured, network error, JSON disabled → 403, no results). Never
// throws — the caller treats [] as "fall back to DuckDuckGo".
async function searxngResults(query) {
  if (!SEARXNG_URL) return [];
  try {
    const raw = await fetchText(
      `${SEARXNG_URL}/search?q=${encodeURIComponent(query)}&format=json&safesearch=0&language=en`
    );
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.results)) return [];
    const out = [];
    for (const r of data.results) {
      if (out.length >= 6) break;
      const link = String(r.url || '');
      const title = htmlToText(String(r.title || ''));
      const snippet = htmlToText(String(r.content || ''));
      if (title && /^https?:\/\//.test(link)) out.push({ title, snippet, link });
    }
    return out;
  } catch {
    return [];
  }
}

// ── Bundled metasearch (zero setup, works for every user) ────────────────────
// Queries several keyless engines in parallel from the user's own machine, then
// merges and dedupes. Same resilience principle as SearXNG — one engine being
// blocked can't zero out the result set — but nothing to install: it runs
// in-process over the existing fetchText (real UA, redirects, size cap). Every
// engine returns [] on any failure and is bounded by a per-engine timeout so one
// slow/blocked source can't stall the whole search.

function metaTimeout(p, ms = 7000) {
  return Promise.race([p, new Promise((res) => setTimeout(() => res([]), ms))]);
}

function normUrl(u) {
  try {
    const x = new URL(u);
    x.hash = '';
    for (const p of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref', 'fbclid']) {
      x.searchParams.delete(p);
    }
    return x.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return String(u || '').toLowerCase();
  }
}

// DuckDuckGo HTML — the original parser, now one engine among many.
async function engDdgHtml(query) {
  try {
    const html = await fetchText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=us-en`);
    const out = [];
    for (const block of html.split(/class="result[ "]/).slice(1)) {
      if (out.length >= 6) break;
      const titleM = block.match(/result__a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      if (!titleM) continue;
      const snipM = block.match(/result__snippet[^>]*>([\s\S]*?)<\/a>/);
      let link = titleM[1];
      const uddg = link.match(/uddg=([^&]+)/);
      if (uddg) { try { link = decodeURIComponent(uddg[1]); } catch {} }
      const title = htmlToText(titleM[2]);
      if (title) out.push({ title, snippet: snipM ? htmlToText(snipM[1]) : '', link });
    }
    return out;
  } catch { return []; }
}

// DuckDuckGo Lite — a much simpler page, often reachable when the main HTML
// endpoint is throttled.
async function engDdgLite(query) {
  try {
    const html = await fetchText(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`);
    const out = [];
    const re = /<a[^>]*class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(html)) && out.length < 6) {
      let link = m[1];
      const uddg = link.match(/uddg=([^&]+)/);
      if (uddg) { try { link = decodeURIComponent(uddg[1]); } catch {} }
      const title = htmlToText(m[2]);
      if (title && /^https?:\/\//.test(link)) out.push({ title, snippet: '', link });
    }
    return out;
  } catch { return []; }
}

// Bing — large independent index, tolerant of light scraping with a real UA.
async function engBing(query) {
  try {
    const html = await fetchText(`https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en-us`);
    const out = [];
    for (const block of html.split(/<li class="b_algo"/).slice(1)) {
      if (out.length >= 6) break;
      const titleM = block.match(/<h2>[\s\S]*?<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      if (!titleM) continue;
      const snipM = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
      const title = htmlToText(titleM[2]);
      if (title) out.push({ title, snippet: snipM ? htmlToText(snipM[1]) : '', link: titleM[1] });
    }
    return out;
  } catch { return []; }
}

// Mojeek — an independent crawler (not a Google/Bing reseller), so it rarely
// fails at the same time as the others.
async function engMojeek(query) {
  try {
    const html = await fetchText(`https://www.mojeek.com/search?q=${encodeURIComponent(query)}`);
    const out = [];
    const re = /<a[^>]*class="[^"]*title[^"]*"[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(html)) && out.length < 6) {
      const title = htmlToText(m[2]);
      if (title) out.push({ title, snippet: '', link: m[1] });
    }
    return out;
  } catch { return []; }
}

// Wikipedia — clean JSON API, never blocks; a reliable factual anchor.
async function engWikipedia(query) {
  try {
    const raw = await fetchText(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=4&srsearch=${encodeURIComponent(query)}`
    );
    const data = JSON.parse(raw);
    const hits = (data && data.query && data.query.search) || [];
    return hits
      .map((h) => ({
        title: htmlToText(String(h.title || '')),
        snippet: htmlToText(String(h.snippet || '')),
        link: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(h.title || '').replace(/ /g, '_'))}`,
      }))
      .filter((r) => r.title);
  } catch { return []; }
}

const META_ENGINES = [engDdgHtml, engDdgLite, engBing, engMojeek, engWikipedia];

// Run every engine in parallel, but DON'T block on the slowest. Resolve as soon
// as we have enough merged results, OR all engines finish, OR a hard deadline
// hits — whichever comes first. Without this, one slow/blocked engine added its
// full timeout to EVERY search round, and a multi-round agent search stacked
// those waits into a minute-plus of silence.
const META_DEADLINE_MS = 4000;
const META_ENOUGH = 6;

function metaSearch(query, engines = META_ENGINES, deadlineMs = META_DEADLINE_MS) {
  const byUrl = new Map();
  const absorb = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const r of arr) {
      if (!r || !r.title || !/^https?:\/\//.test(r.link || '')) continue;
      const key = normUrl(r.link);
      const cur = byUrl.get(key);
      if (cur) {
        cur.hits++;
        if ((r.snippet || '').length > (cur.snippet || '').length) cur.snippet = r.snippet;
      } else {
        byUrl.set(key, { title: r.title, snippet: r.snippet || '', link: r.link, hits: 1 });
      }
    }
  };
  const rank = () =>
    [...byUrl.values()]
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 8)
      .map(({ title, snippet, link }) => ({ title, snippet, link }));

  return new Promise((resolve) => {
    let settled = false;
    let done = 0;
    const counts = {};
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Per-engine visibility on the live path: which sources answered, how many,
      // and the merged total. `-1` = errored/blocked, `·` = didn't beat the
      // deadline. Distinguishes "search is thin" from other quality issues.
      if (engines === META_ENGINES) {
        try {
          const line = engines.map((f) => `${f.name || 'eng'}=${f.name in counts ? counts[f.name] : '·'}`).join(' ');
          console.log(`[SEARCHDBG] "${query}" ${line} -> merged ${byUrl.size}`);
        } catch {}
      }
      resolve(rank());
    };
    const timer = setTimeout(finish, deadlineMs);
    for (const fn of engines) {
      Promise.resolve()
        .then(() => fn(query))
        .then((arr) => {
          counts[fn.name] = Array.isArray(arr) ? arr.length : 0;
          absorb(arr);
        })
        .catch(() => {
          counts[fn.name] = -1;
        })
        .finally(() => {
          done++;
          if (byUrl.size >= META_ENOUGH || done === engines.length) finish();
        });
    }
  });
}

async function runSearch(args) {
  const query = (args.query || '').trim();
  if (!query) return 'No query provided.';

  try {
    // DDG Instant Answer JSON — a quick, keyless factual hit (definitions, some
    // live values). Cheap and rarely blocked; prepended when present.
    let instant = '';
    try {
      const iaRaw = await fetchText(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`
      );
      const ia = JSON.parse(iaRaw);
      if (ia.AbstractText) instant += `${ia.Heading || query}: ${ia.AbstractText}\n`;
      if (ia.Answer) instant += `Answer: ${ia.Answer}\n`;
      if (ia.Definition) instant += `Definition: ${ia.Definition}\n`;
    } catch {}

    // Primary: self-hosted SearXNG (operators who set SEARXNG_URL).
    let results = await searxngResults(query);

    // Default for everyone: bundled in-process metasearch — parallel multi-engine,
    // merged and deduped, no setup and no third-party API key.
    if (results.length === 0) results = await metaSearch(query);

    if (results.length === 0) return `No results found for "${query}".`;

    // Snippets are often just link descriptions and don't contain the actual
    // answer (the live score, the price). So we also FETCH the top result page(s)
    // and include their readable text. Fetch the top 2 in parallel, keep it cheap,
    // and never let a slow/blocked page break or stall the search.
    let pageContext = '';
    try {
      const top = results.slice(0, 2).filter((r) => r.link && /^https?:\/\//.test(r.link));
      const pages = await Promise.all(
        top.map(async (r) => {
          try {
            const text = await runFetchUrl({ url: r.link });
            if (text && !/^Could not fetch|^Page had no readable/.test(text)) {
              return `\n\n--- Page content from ${r.link} ---\n${text.slice(0, 3500)}`;
            }
          } catch {}
          return '';
        })
      );
      pageContext = pages.join('');
    } catch {}

    const summary = results
      .map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}\n${r.link}`)
      .join('\n\n');
    return (instant ? `${instant}\n` : '') + summary + pageContext +
      `\n\nAnswer the user's question using the information above. If it contains the specific value asked for (a temperature, price, score, etc.), state that value directly. Include source references as [Source]: URL at the end of your answer.`;
  } catch (e) {
    return `Search failed: ${e.message}`;
  }
}

// ═══════════════════════════════════════════════════
// TOOL: calculate
// ═══════════════════════════════════════════════════
function runCalculate(args) {
  const expr = String(args.expression || '').trim();
  if (!expr) return 'No expression provided.';
  // Allow only safe math characters — no arbitrary code execution.
  if (!/^[0-9+\-*/().,%\s^eE]+$/.test(expr)) {
    return 'Expression contains unsupported characters. Use numbers and + - * / ( ) % ^ only.';
  }
  try {
    // ^ → ** for exponent
    const safe = expr.replace(/\^/g, '**');
    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${safe});`)();
    if (typeof result !== 'number' || !isFinite(result)) return 'Could not evaluate.';
    return String(result);
  } catch {
    return 'Could not evaluate that expression.';
  }
}

// ═══════════════════════════════════════════════════
// TOOL: get_datetime
// ═══════════════════════════════════════════════════
function runDateTime() {
  const now = new Date();
  return JSON.stringify({
    iso: now.toISOString(),
    date: now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    time: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
}

// ═══════════════════════════════════════════════════
// TOOL: fetch_url — read a webpage's text
// ═══════════════════════════════════════════════════
async function runFetchUrl(args) {
  let url = (args.url || '').trim();
  if (!url) return 'No URL provided.';
  if (!/^https?:\/\//.test(url)) url = 'https://' + url;
  try {
    const html = await fetchText(url, { maxBytes: 600000 });
    // YouTube: the page is a JS shell with no readable body text, but it carries
    // rich metadata (title, channel, description, views, date) in og: tags and a
    // JSON blob. Pull that so the model can answer "what is this video about?".
    // NOTE: this is metadata only — it cannot describe what happens IN the video
    // (that needs the transcript, which YouTube increasingly gates).
    if (/(?:youtube\.com|youtu\.be)/i.test(url)) {
      const yt = extractYouTubeMeta(html);
      if (yt) return yt;
      // fall through to generic text if extraction failed
    }
    const text = htmlToText(html);
    return text.slice(0, 6000) || 'Page had no readable text.';
  } catch (e) {
    return `Could not fetch page: ${e.message}`;
  }
}

// Pull YouTube metadata from page HTML (og: meta tags + embedded JSON).
function extractYouTubeMeta(html) {
  const meta = (prop) => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`, 'i');
    const m = html.match(re);
    return m ? decodeEntities(m[1]) : '';
  };
  const title = meta('og:title') || meta('title');
  const channel = (html.match(/"author":"([^"]+)"/) || [])[1] || meta('og:video:tag');
  // Description: prefer the longer shortDescription JSON field over og:description.
  let desc = (html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/) || [])[1] || '';
  if (desc) { try { desc = JSON.parse('"' + desc + '"'); } catch {} }
  if (!desc) desc = meta('og:description');
  const views = (html.match(/"viewCount":"(\d+)"/) || [])[1];
  const date = (html.match(/"uploadDate":"([^"]+)"/) || [])[1]
            || (html.match(/"publishDate":"([^"]+)"/) || [])[1];
  const lengthSec = (html.match(/"lengthSeconds":"(\d+)"/) || [])[1];
  if (!title) return null;
  const parts = [`YouTube video: "${title}"`];
  if (channel) parts.push(`Channel: ${channel}`);
  if (date) parts.push(`Published: ${date.slice(0, 10)}`);
  if (views) parts.push(`Views: ${Number(views).toLocaleString()}`);
  if (lengthSec) { const m = Math.floor(lengthSec / 60), s = lengthSec % 60; parts.push(`Length: ${m}m ${s}s`); }
  if (desc) parts.push(`\nDescription:\n${desc.slice(0, 2500)}`);
  parts.push('\n(This is the video\u2019s metadata and description. I can\u2019t watch the video itself, so I can\u2019t describe footage or spoken content beyond what the description says.)');
  return parts.join('\n');
}

function decodeEntities(s) {
  return String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
}

// ═══════════════════════════════════════════════════
// TOOL: deep_research — multi-step search + synthesis
// ═══════════════════════════════════════════════════

async function runFindImage(args) {
  const query = (args.query || '').trim();
  if (!query) return 'No query provided.';
  const RENDERABLE = /^image\/(jpeg|png|gif|webp|svg\+xml)$/i;
  try {
    const api = 'https://commons.wikimedia.org/w/api.php?action=query&format=json'
      + '&generator=search&gsrnamespace=6&gsrlimit=6'
      + '&gsrsearch=' + encodeURIComponent(query)
      + '&prop=imageinfo&iiprop=url|mime|extmetadata&iiurlwidth=1200';
    const raw = await fetchText(api, { timeoutMs: 9000, maxBytes: 800000 });
    const data = JSON.parse(raw);
    const pages = data && data.query && data.query.pages ? Object.values(data.query.pages) : [];
    const imgs = [];
    for (const pg of pages) {
      const info = pg.imageinfo && pg.imageinfo[0];
      if (!info) continue;
      const src = info.thumburl || (RENDERABLE.test(info.mime || '') ? info.url : null);
      if (!src) continue;
      const md = info.extmetadata || {};
      const license = md.LicenseShortName && md.LicenseShortName.value ? htmlToText(String(md.LicenseShortName.value)) : '';
      const artist = md.Artist && md.Artist.value ? htmlToText(String(md.Artist.value)).slice(0, 120) : '';
      imgs.push({
        title: (pg.title || 'Image').replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, ''),
        url: src,
        source: info.descriptionurl || '',
        license, artist,
      });
      if (imgs.length >= 4) break;
    }
    if (!imgs.length) {
      return `No displayable image was found for "${query}" on Wikimedia Commons. Tell the user you could not find a real image to show. Do NOT invent or guess an image URL.`;
    }
    const best = imgs[0];
    const cap = [best.title, best.license ? `via Wikimedia Commons (${best.license})` : 'via Wikimedia Commons'].filter(Boolean).join(' \u2014 ');
    const snippet =
      '<figure style="margin:0;text-align:center;font-family:system-ui,-apple-system,sans-serif">\n' +
      `  <img src="${best.url}" alt="${best.title.replace(/"/g, '')}" style="max-width:100%;height:auto;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.12)">\n` +
      `  <figcaption style="font-size:.85rem;color:#666;margin-top:.6rem">${cap}</figcaption>\n` +
      '</figure>';
    const list = imgs.map((im, i) =>
      `${i + 1}. ${im.title}\n   url: ${im.url}` +
      (im.license ? `\n   license: ${im.license}${im.artist ? ` \u2014 ${im.artist}` : ''}` : '') +
      (im.source ? `\n   source: ${im.source}` : '')
    ).join('\n');
    return `Found ${imgs.length} real image(s) for "${query}" on Wikimedia Commons:\n\n${list}\n\n`
      + 'TO SHOW THE IMAGE: your reply MUST contain the block below EXACTLY AS-IS, keeping the opening ```html line and the closing ``` line. That fence is what renders the image; HTML pasted WITHOUT the ``` fence shows as plain text and the user sees no image. Do not change the URL. Add at most one short sentence before the block, and nothing after.\n\n'
      + '```html\n' + snippet + '\n```';
  } catch (e) {
    return `Image lookup failed: ${e.message}. Tell the user you could not fetch an image to show; do not invent an image URL.`;
  }
}

async function runDeepResearch({ topic }) {
  if (!topic) return 'No topic provided.';

  // Generate 3-4 search queries from different angles
  const queries = [
    topic,
    `${topic} latest developments 2026`,
    `${topic} analysis expert opinion`,
    `${topic} comparison alternatives`,
  ];

  const allResults = [];
  for (const query of queries) {
    try {
      const result = await runSearch({ query });
      if (result && !result.startsWith('Search failed') && !result.startsWith('No results')) {
        allResults.push(`=== Search: "${query}" ===\n${result}`);
      }
    } catch {}
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 500));
  }

  if (allResults.length === 0) return `Could not find information about "${topic}".`;

  return `DEEP RESEARCH RESULTS for "${topic}"\n\n` +
    allResults.join('\n\n') +
    `\n\n---\nSynthesize the above research into a comprehensive, well-organized answer. Include key findings, different perspectives, and source references as [Source]: URL.`;
}

// ═══════════════════════════════════════════════════
// TOOL: run_command — execute a shell command on the user's machine
// ═══════════════════════════════════════════════════

const { execSync } = require('child_process');
const os = require('os');
const path = require('path');
const gitTools = require('./git-tools');

// TOOL: publish_app — make an HTML app/page instantly live at a public URL on the
// user's OWN Aspen, through the private tunnel that's already running. No git, no
// deploy, no accounts. Publishes via the local gateway's /publish-artifact route
// (served at /artifacts/<id>), authenticating with the owner key.
async function publishApp({ html, name } = {}) {
  if (!html || typeof html !== 'string' || html.trim().length < 20) {
    return 'Provide the complete, self-contained HTML document for the app.';
  }
  try {
    const http = require('http');
    let key = '';
    try { key = (require('./apikeys').listKeys().find((k) => k.owner) || {}).secret || ''; } catch {}
    const body = JSON.stringify({ html, name: name || '' });
    const res = await new Promise((resolve) => {
      const rq = http.request(
        { hostname: '127.0.0.1', port: 4000, path: '/publish-artifact', method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...(key ? { Authorization: `Bearer ${key}` } : {}) } },
        (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => resolve({ status: r.statusCode, body: d })); }
      );
      rq.on('error', (e) => resolve({ status: 0, body: String(e.message) }));
      rq.write(body); rq.end();
    });
    if (res.status === 200) {
      const p = JSON.parse(res.body).path; // e.g. /artifacts/recipe-app-ab12cd
      let base = '';
      try { base = require('./tunnel').getPublicUrl() || ''; } catch {}
      base = String(base).replace(/\/v1\/?$/, '').replace(/\/+$/, '');
      const full = base ? base + p : `http://localhost:4000${p}`;
      return `Published and live now. Open it here: ${full}\nThat is the full, clickable link — it opens the app served from this machine through the user's own Aspen. Give the user exactly this URL.`;
    }
    if (res.status === 401) return 'Publishing needs an owner key configured on this Aspen.';
    return `Could not publish (HTTP ${res.status}).`;
  } catch (e) {
    return `Publish failed: ${e.message}`;
  }
}

function runCommand({ command, cwd }) {
  if (!command || typeof command !== 'string') return 'Error: command is required';
  const workDir = cwd || os.homedir();
  try {
    const output = execSync(command, {
      cwd: workDir,
      timeout: 60000,         // 60s max (git push can be slow)
      maxBuffer: 1024 * 512,  // 512KB
      encoding: 'utf8',
      shell: true,
      env: { ...process.env, HOME: os.homedir(), PATH: process.env.PATH },
    });
    const trimmed = output.length > 50000 ? output.slice(0, 50000) + '\n... (truncated)' : output;
    return trimmed || '(no output)';
  } catch (e) {
    // Include both stdout and stderr from failed commands
    const out = (e.stdout || '') + (e.stderr || '');
    return `Exit code ${e.status || 1}:\n${out || e.message}`.slice(0, 50000);
  }
}

// ═══════════════════════════════════════════════════
// TOOL: download_file — fetch a URL and save it to disk (owner-gated upstream)
// ═══════════════════════════════════════════════════
const fs = require('fs');

function runDownloadFile({ url, filename, dir }) {
  if (!url || typeof url !== 'string') return Promise.resolve('Error: url is required');
  let u = url.trim();
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  let parsed;
  try { parsed = new URL(u); } catch { return Promise.resolve(`Error: invalid url ${u}`); }
  // SSRF guard: block internal hosts/IPs (same posture as fetch_url).
  if (typeof hostIsBlocked === 'function' && hostIsBlocked(parsed.hostname)) {
    return Promise.resolve(`Error: refusing to download from internal host ${parsed.hostname}`);
  }
  // Default download dir under the Aspen workspace so files are easy to find.
  const baseDir = dir || path.join(os.homedir(), '.aspen', 'downloads');
  try { fs.mkdirSync(baseDir, { recursive: true }); } catch {}
  // Derive a safe filename.
  let name = filename || path.basename(parsed.pathname) || `download_${Date.now()}`;
  name = name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || `download_${Date.now()}`;
  const dest = path.join(baseDir, name);

  return new Promise((resolve) => {
    const lib = parsed.protocol === 'http:' ? http : https;
    const MAX = 50 * 1024 * 1024; // 50MB cap
    const req = lib.get(u, { timeout: 60000, headers: { 'User-Agent': 'Aspen/1.0' } }, (res) => {
      // Follow one redirect.
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve(runDownloadFile({ url: new URL(res.headers.location, u).toString(), filename: name, dir: baseDir }));
      }
      if (res.statusCode !== 200) { res.resume(); return resolve(`Error: HTTP ${res.statusCode} downloading ${u}`); }
      let bytes = 0; let aborted = false;
      const out = fs.createWriteStream(dest);
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX) { aborted = true; req.destroy(); out.destroy(); try { fs.unlinkSync(dest); } catch {}; resolve(`Error: file exceeds 50MB cap`); }
      });
      res.pipe(out);
      out.on('finish', () => { if (!aborted) { out.close(() => resolve(`Saved ${bytes} bytes to ${dest}`)); } });
      out.on('error', (e) => resolve(`Error writing file: ${e.message}`));
    });
    req.on('timeout', () => { req.destroy(); resolve('Error: download timed out'); });
    req.on('error', (e) => resolve(`Error: ${e.message}`));
  });
}


// Human-readable, ARG-AWARE status line for the reasoning trail. Says what the
// model is actually doing ("Searching the web for X"), not just the tool name.
// Shared by the desktop agent (agent.js) and the gateway agent (gateway-agent.js)
// so all three chat surfaces narrate identically.
function describeToolStatus(name, args = {}) {
  const a = args || {};
  const clip = (s, n = 60) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const host = (u) => { try { return new URL(/^https?:\/\//.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, ''); } catch { return clip(u, 40); } };
  switch (name) {
    case 'web_search':       return a.query ? `🔍 Searching the web for “${clip(a.query, 50)}”` : '🔍 Searching the web…';
    case 'deep_research':    return a.topic ? `📚 Researching “${clip(a.topic, 50)}”` : '📚 Researching…';
    case 'fetch_url':        return a.url ? `🌐 Reading ${host(a.url)}` : '🌐 Reading the page…';
    case 'calculate':        return a.expression ? `🔢 Calculating ${clip(a.expression, 40)}` : '🔢 Calculating…';
    case 'get_datetime':     return '🕐 Checking the date & time';
    case 'run_command':      return a.command ? `⚡ Running: ${clip(a.command, 50)}` : '⚡ Running a command…';
    case 'find_image':       return a.query ? `🖼️ Finding an image of “${clip(a.query, 40)}”` : '🖼️ Finding an image…';
    case 'download_file':    return a.url ? `⬇️ Downloading ${host(a.url)}` : '⬇️ Downloading a file…';
    case 'computer_screenshot': return '📸 Taking a screenshot';
    case 'computer_click':   return (a.x != null && a.y != null) ? `🖱️ Clicking (${Math.round(a.x)}, ${Math.round(a.y)})` : '🖱️ Clicking…';
    case 'computer_type':    return a.text ? `⌨️ Typing “${clip(a.text, 40)}”` : '⌨️ Typing…';
    case 'computer_key':     return a.combo ? `⌨️ Pressing ${a.combo}` : '⌨️ Pressing a key';
    case 'computer_scroll':  return `🖱️ Scrolling ${a.direction || 'down'}`;
    default:                 return `⚙️ ${String(name).replace(/__/g, ' · ').replace(/_/g, ' ')}…`;
  }
}

const TOOLS = {
  web_search: {
    definition: {
      type: 'function',
      function: {
        name: 'web_search',
        description: 'Search the web for current information, news, facts, prices, or anything beyond the model\'s training data. Runs locally on the user\'s machine.',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: 'The search query' } },
          required: ['query'],
        },
      },
    },
    run: runSearch,
  },
  calculate: {
    definition: {
      type: 'function',
      function: {
        name: 'calculate',
        description: 'Evaluate a math expression. Supports + - * / ( ) % and ^ for exponent.',
        parameters: {
          type: 'object',
          properties: { expression: { type: 'string', description: 'e.g. "(1234 * 5.5) / 3"' } },
          required: ['expression'],
        },
      },
    },
    run: (a) => Promise.resolve(runCalculate(a)),
  },
  get_datetime: {
    definition: {
      type: 'function',
      function: {
        name: 'get_datetime',
        description: 'Get the current date, time, and timezone on the user\'s machine.',
        parameters: { type: 'object', properties: {} },
      },
    },
    run: () => Promise.resolve(runDateTime()),
  },
  fetch_url: {
    definition: {
      type: 'function',
      function: {
        name: 'fetch_url',
        description: 'Fetch and read the text content of a specific web page URL.',
        parameters: {
          type: 'object',
          properties: { url: { type: 'string', description: 'The full URL to fetch' } },
          required: ['url'],
        },
      },
    },
    run: runFetchUrl,
  },
  find_image: {
    definition: {
      type: 'function',
      function: {
        name: 'find_image',
        description: 'Find a REAL, displayable image for a query - a photo, scan, artwork, manuscript page, diagram, map, landmark, animal, etc. Use this whenever the user asks to see, show, or display a picture, or asks "what does X look like". Returns real, verified image URLs (from Wikimedia) that you put inside an HTML artifact to actually show the image. NEVER invent image URLs - always get them from this tool.',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: 'What to find an image of, e.g. "Voynich manuscript folio 1r" or "Eiffel Tower at night"' } },
          required: ['query'],
        },
      },
    },
    run: runFindImage,
  },
  run_command: {
    definition: {
      type: 'function',
      function: {
        name: 'run_command',
        description: 'Execute ANY shell command on the user\'s machine. You MUST use this for: git clone/add/commit/push, writing files (cat > file << EOF), reading files (cat), mkdir, ls, npm, pip, and all terminal tasks. NEVER tell the user to run commands — call this tool instead. Returns stdout/stderr. EXCEPTION: to SHOW the user an HTML or SVG page, card, or app, output it inline as a fenced html/svg code block (a renderable artifact) instead of writing it to a file — only write a file when they explicitly ask to save one.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'The shell command to run, e.g. "git clone https://..." or "ls -la" or "cat file.txt"' },
            cwd: { type: 'string', description: 'Working directory (defaults to home directory)' },
          },
          required: ['command'],
        },
      },
    },
    run: runCommand,
  },
  download_file: {
    definition: {
      type: 'function',
      function: {
        name: 'download_file',
        description: 'Download a file (image, PDF, dataset, video, etc.) from a URL and save it to the user\'s machine. Use this to fetch files you then need to analyze or process. Returns the saved local path. Saves to ~/.aspen/downloads by default.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'The URL of the file to download' },
            filename: { type: 'string', description: 'Optional filename to save as (e.g. "page1.jpg")' },
            dir: { type: 'string', description: 'Optional directory to save into (defaults to ~/.aspen/downloads)' },
          },
          required: ['url'],
        },
      },
    },
    run: runDownloadFile,
  },
  git_clone: {
    definition: {
      type: 'function',
      function: {
        name: 'git_clone',
        description: "Clone a GitHub repo into the Aspen workspace. Uses the owner's saved token by default; if the user pastes a token/PAT in the conversation, pass it in `token`. Use https://github.com/<owner>/<name>.",
        parameters: {
          type: 'object',
          properties: {
            repo: { type: 'string', description: 'https://github.com/<owner>/<name>' },
            dir: { type: 'string', description: 'Optional workspace folder name' },
            token: { type: 'string', description: 'Optional GitHub token (PAT) to authenticate this clone. Pass it if the user provided one. Used only for this call — never stored or shown.' },
          },
          required: ['repo'],
        },
      },
    },
    run: (a) => gitTools.gitClone(a || {}),
  },
  git_status: {
    definition: {
      type: 'function',
      function: {
        name: 'git_status',
        description: 'Show the git status (branch + changed files) of a repo in the Aspen workspace.',
        parameters: { type: 'object', properties: { dir: { type: 'string', description: 'Workspace folder name' } }, required: ['dir'] },
      },
    },
    run: (a) => gitTools.gitStatus(a || {}),
  },
  git_commit_push: {
    definition: {
      type: 'function',
      function: {
        name: 'git_commit_push',
        description: "Stage all changes, commit, and push to origin. Uses the owner's saved token by default; if the user pastes a token/PAT, pass it in `token`. For repos that auto-deploy on push, this also deploys.",
        parameters: {
          type: 'object',
          properties: {
            dir: { type: 'string', description: 'Workspace folder name' },
            message: { type: 'string', description: 'Commit message' },
            branch: { type: 'string', description: 'Branch to push (default: current HEAD)' },
            token: { type: 'string', description: 'Optional GitHub token (PAT) to authenticate the push. Pass it if the user provided one. Used only for this call — never stored or shown.' },
          },
          required: ['dir', 'message'],
        },
      },
    },
    run: (a) => gitTools.gitCommitPush(a || {}),
  },
  git_create_repo: {
    definition: {
      type: 'function',
      function: {
        name: 'git_create_repo',
        description: "Create a new GitHub repository (git can't create repos — this does, via the API). Use when the target repo doesn't exist yet, then git_clone + git_commit_push. Uses the owner's saved token or a pasted `token`. Free on GitHub.",
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Repo name, e.g. "crowdpick" or "owner/crowdpick"' },
            private: { type: 'boolean', description: 'Make it private? Default true.' },
            description: { type: 'string', description: 'Optional repo description' },
            token: { type: 'string', description: 'Optional GitHub token (PAT), needs "repo" scope. Pass it if the user provided one. Used only for this call — never stored or shown.' },
          },
          required: ['name'],
        },
      },
    },
    run: (a) => gitTools.gitCreateRepo(a || {}),
  },
  publish_app: {
    definition: {
      type: 'function',
      function: {
        name: 'publish_app',
        description: "Make an HTML app or page INSTANTLY LIVE at a public URL on the user's own Aspen — no git, no deploy, no setup, no accounts. This is the easy way to ship something the user can open or share. Whenever the user asks to build/make an app, site, page, tool, or game they want to USE or SHARE, write the complete self-contained HTML and call this. Prefer this over git for anything the user just wants live.",
        parameters: {
          type: 'object',
          properties: {
            html: { type: 'string', description: 'The COMPLETE, self-contained HTML document (inline CSS/JS). Must render on its own.' },
            name: { type: 'string', description: 'Short friendly name for the app — used in the URL (e.g. "recipe-box").' },
          },
          required: ['html'],
        },
      },
    },
    run: (a) => publishApp(a || {}),
  },
  start_mission: {
    definition: {
      type: 'function',
      function: {
        name: 'start_mission',
        description: "Start a long-running BACKGROUND mission that Aspen keeps working on 24/7, one step at a time, even after this chat ends — it journals progress and resumes across restarts. Use when the user says 'keep working on X', 'run this in the background', 'keep at it', 'work on this continuously/24-7'. Be honest that hard open problems (e.g. deciphering an unsolved manuscript) may never fully complete, but it will keep making and recording progress.",
        parameters: {
          type: 'object',
          properties: {
            goal: { type: 'string', description: 'The mission goal, e.g. "decipher the Voynich manuscript"' },
            minutes: { type: 'number', description: 'Minutes between steps (default 3, minimum 1)' },
          },
          required: ['goal'],
        },
      },
    },
    run: (a) => {
      const ao = require('./always-on');
      const r = ao.start(a.goal, { intervalMs: Math.max(1, a.minutes || 3) * 60000 });
      return r.error ? r.error : `Mission started (${r.id}). Aspen will keep working on "${r.goal}" in the background, step by step. Ask "mission status" anytime to see progress, or "stop mission ${r.id}" to end it.`;
    },
  },
  mission_status: {
    definition: {
      type: 'function',
      function: { name: 'mission_status', description: 'Report the status and latest progress of background missions.', parameters: { type: 'object', properties: {} } },
    },
    run: () => {
      const ao = require('./always-on');
      const s = ao.status();
      if (!s.length) return 'No background missions right now.';
      return s.map((m) => `• [${m.status}] ${m.goal} — ${m.steps} steps${m.lastStep ? `, last ${m.lastStep}` : ''}\n  Latest: ${(m.latest[m.latest.length - 1] || '(none yet)').slice(0, 400)}`).join('\n\n');
    },
  },
  stop_mission: {
    definition: {
      type: 'function',
      function: { name: 'stop_mission', description: 'Stop a background mission by id, or "all" to stop every mission.', parameters: { type: 'object', properties: { id: { type: 'string', description: 'Mission id, or "all"' } }, required: ['id'] } },
    },
    run: (a) => {
      const ao = require('./always-on');
      if (String(a.id).toLowerCase() === 'all') { ao.stopAll(); return 'All missions stopped.'; }
      const r = ao.stop(a.id);
      return r.stopped ? 'Mission stopped.' : 'No active mission with that id.';
    },
  },
  deep_research: {
    definition: {
      type: 'function',
      function: {
        name: 'deep_research',
        description: 'Deep research on a topic — performs multiple web searches, fetches key pages, and compiles a comprehensive research brief. Use when the user wants thorough research, analysis, or a report on a topic.',
        parameters: {
          type: 'object',
          properties: {
            topic: { type: 'string', description: 'The topic to research thoroughly' },
          },
          required: ['topic'],
        },
      },
    },
    run: runDeepResearch,
  },
};

// ── MCP connector tools ──────────────────────────────────────────────────────
// Tools exposed by connected MCP servers (GitHub, etc.) are merged in alongside
// the built-in local tools. They share the same OpenAI function schema, so the
// agent loop and the model treat them identically. Execution is routed to the
// MCP client. We namespace names as "<connectorId>__<toolName>" to avoid clashes.
let mcpClient = null;
try { mcpClient = require('./mcp-client'); } catch { /* optional */ }

let computerUse = null;
try { computerUse = require('./computer-use'); } catch { computerUse = { COMPUTER_TOOLS: [], executeTool: async () => 'Computer use not available' }; }

function mcpToolDefinitions() {
  if (!mcpClient) return [];
  return mcpClient.listAllTools().map((t) => ({
    type: 'function',
    function: {
      name: `${t.connectorId}__${t.name}`,
      description: t.description,
      parameters: t.inputSchema || { type: 'object', properties: {} },
    },
  }));
}

async function runMcpTool(namespacedName, args) {
  const idx = namespacedName.indexOf('__');
  if (idx < 0) return `Unknown tool: ${namespacedName}`;
  const connectorId = namespacedName.slice(0, idx);
  const toolName = namespacedName.slice(idx + 2);
  return mcpClient.callTool(connectorId, toolName, args || {});
}

// Returns OpenAI-format tool definitions for the enabled tools.
function getToolDefinitions(enabledNames) {
  const builtins = Object.entries(TOOLS)
    .filter(([name]) => enabledNames.includes(name))
    .map(([, t]) => t.definition);
  // Computer use tools — only on desktop (Electron), always owner-only.
  // computer-use.js defines them in Anthropic `input_schema` shape, but Ollama
  // (the desktop agent's backend) only understands the OpenAI function shape.
  // Sending the raw Anthropic objects means the model never receives usable
  // computer tools and silently can't drive the screen — so translate here.
  const computerTools = enabledNames.includes('computer_use') && computerUse
    ? (computerUse.COMPUTER_TOOLS || []).map((t) => (
        t.function ? t : {
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.input_schema || t.parameters || { type: 'object', properties: {} },
          },
        }
      ))
    : [];
  return [...builtins, ...computerTools, ...mcpToolDefinitions()];
}

// Execute a tool call by name. Always returns a string (never throws).
async function executeTool(name, args) {
  // Connector tools are namespaced "<id>__<tool>".
  if (name.includes('__') && mcpClient) {
    try { return await runMcpTool(name, args); }
    catch (e) { return `Tool ${name} error: ${e.message}`; }
  }
  // Computer use tools
  if (name.startsWith('computer_')) {
    try { return await computerUse.executeTool(name, args || {}); }
    catch (e) { return `Computer tool ${name} error: ${e.message}`; }
  }
  const tool = TOOLS[name];
  if (!tool) return `Unknown tool: ${name}`;
  try {
    return await tool.run(args || {});
  } catch (e) {
    return `Tool ${name} error: ${e.message}`;
  }
}

const ALL_TOOL_NAMES = [
  ...Object.keys(TOOLS),
  'computer_use', // expands to computer_screenshot, computer_click, computer_type, computer_key, computer_scroll
];

// Some models (depending on their Ollama chat template) emit tool calls as plain
// TEXT in the content instead of the structured `tool_calls` field — e.g.
// {"name":"web_search","parameters":{"query":"..."}} sometimes wrapped in
// template tokens like `}assistant` or <|...|>. Without this, that JSON leaks to
// the user and no tool runs. This pulls valid tool calls back out of the text.
function extractJsonObjects(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    const open = text[i];
    if (open !== '{' && open !== '[') continue;
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') {
        depth--;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(text.slice(i, j + 1));
            if (Array.isArray(parsed)) parsed.forEach(p => p && typeof p === 'object' && out.push(p));
            else if (parsed && typeof parsed === 'object') out.push(parsed);
          } catch {}
          i = j;
          break;
        }
      }
    }
  }
  return out;
}

// Returns native-shaped tool calls ({ id, function:{ name, arguments(JSON string) } })
// parsed from text content, restricted to known tool names. Empty if none.
function parseTextToolCalls(content, validNames) {
  if (!content || typeof content !== 'string') return [];
  const valid = new Set(validNames || []);
  const text = content.replace(/<\|[^>]*\|>/g, ' ');
  const calls = [];
  for (const obj of extractJsonObjects(text)) {
    const name = obj.name || obj.function?.name || (obj.type === 'function' ? obj.function?.name || obj.name : null);
    if (!name || !valid.has(name)) continue;
    const rawArgs = obj.parameters ?? obj.arguments ?? obj.function?.arguments ?? {};
    calls.push({
      id: `call_${name}_${calls.length}`,
      type: 'function',
      function: { name, arguments: typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs) },
    });
  }
  return calls;
}

module.exports = { getToolDefinitions, executeTool, ALL_TOOL_NAMES, runFetchUrl, hostIsBlocked, ipIsBlocked, describeToolStatus, parseTextToolCalls, normUrl, metaSearch, searxngResults };
