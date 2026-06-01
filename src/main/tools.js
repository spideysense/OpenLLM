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

// ── helper: fetch a URL (follows simple redirects), returns text ──
function fetchText(url, { timeoutMs = 8000, maxBytes = 200000 } = {}) {
  return new Promise((resolve, reject) => {
    let lib;
    try { lib = url.startsWith('https') ? https : http; } catch { return reject(new Error('bad url')); }
    const req = lib.get(url, {
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
// TOOL: web_search — runs from the USER's machine/IP (distributed, private)
// ═══════════════════════════════════════════════════
async function runSearch(args) {
  const query = (args.query || '').trim();
  if (!query) return 'No query provided.';

  // DuckDuckGo HTML endpoint — queried directly from the user's own machine.
  // Because each user searches from their own IP, there is no single-IP
  // rate-limit cliff (the failure mode of a central server).
  try {
    const html = await fetchText(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=us-en`
    );
    const results = [];
    const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(html)) && results.length < 6) {
      const title = htmlToText(m[2]);
      const snippet = htmlToText(m[3]);
      let link = m[1];
      // DDG wraps links in a redirect; pull out the real uddg= target
      const uddg = link.match(/uddg=([^&]+)/);
      if (uddg) { try { link = decodeURIComponent(uddg[1]); } catch {} }
      if (title) results.push({ title, snippet, link });
    }
    if (results.length === 0) return `No results found for "${query}".`;
    return results
      .map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}\n${r.link}`)
      .join('\n\n');
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
    const html = await fetchText(url, { maxBytes: 300000 });
    const text = htmlToText(html);
    return text.slice(0, 4000) || 'Page had no readable text.';
  } catch (e) {
    return `Could not fetch page: ${e.message}`;
  }
}

// ═══════════════════════════════════════════════════
// Registry — definitions (sent to the model) + runners
// ═══════════════════════════════════════════════════
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
};

// Returns OpenAI-format tool definitions for the enabled tools.
function getToolDefinitions(enabledNames) {
  return Object.entries(TOOLS)
    .filter(([name]) => enabledNames.includes(name))
    .map(([, t]) => t.definition);
}

// Execute a tool call by name. Always returns a string (never throws).
async function executeTool(name, args) {
  const tool = TOOLS[name];
  if (!tool) return `Unknown tool: ${name}`;
  try {
    return await tool.run(args || {});
  } catch (e) {
    return `Tool ${name} error: ${e.message}`;
  }
}

const ALL_TOOL_NAMES = Object.keys(TOOLS);

module.exports = { getToolDefinitions, executeTool, ALL_TOOL_NAMES };
