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
    // Layer 1: DDG Instant Answer JSON — clean structured data (definitions,
    // facts, some live values), no scraping. Runs from the user's machine.
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

    const html = await fetchText(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=us-en`
    );

    // Parse per result block. DDG groups each hit under a container that holds a
    // .result__a (title+link) and a .result__snippet. We split on the result
    // boundary and pull each piece out INDEPENDENTLY, so a change in element
    // order or extra attributes can't break extraction (the old single combined
    // regex required an exact title→snippet ordering and silently matched 0).
    const results = [];
    const blocks = html.split(/class="result[ "]/).slice(1);
    for (const block of blocks) {
      if (results.length >= 6) break;
      const titleM = block.match(/result__a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      const snipM = block.match(/result__snippet[^>]*>([\s\S]*?)<\/a>/);
      if (!titleM) continue;
      const title = htmlToText(titleM[2]);
      let link = titleM[1];
      const uddg = link.match(/uddg=([^&]+)/);
      if (uddg) { try { link = decodeURIComponent(uddg[1]); } catch {} }
      const snippet = snipM ? htmlToText(snipM[1]) : '';
      if (title) results.push({ title, snippet, link });
    }

    if (results.length === 0) return `No results found for "${query}".`;

    // Snippets are often just link descriptions ("the most accurate forecast...")
    // and don't contain the actual answer (the live temperature, the price). So we
    // also FETCH the top result page(s) and include their readable text — this is
    // where the real value lives. Without this, the model only has links and can
    // only say "check these sites" instead of answering. Fetch the top 2 in
    // parallel, keep it cheap, and never let a slow/blocked page break the search.
    let pageContext = '';
    try {
      const top = results.slice(0, 3).filter((r) => r.link && /^https?:\/\//.test(r.link));
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
      `\n\nAnswer the user's question using the information above. If it contains the specific value asked for (a temperature, price, score, etc.), state that value directly.`;
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

// ── MCP connector tools ──────────────────────────────────────────────────────
// Tools exposed by connected MCP servers (GitHub, etc.) are merged in alongside
// the built-in local tools. They share the same OpenAI function schema, so the
// agent loop and the model treat them identically. Execution is routed to the
// MCP client. We namespace names as "<connectorId>__<toolName>" to avoid clashes.
let mcpClient = null;
try { mcpClient = require('./mcp-client'); } catch { /* optional */ }

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
  // MCP/connector tools are always offered when their server is connected.
  return [...builtins, ...mcpToolDefinitions()];
}

// Execute a tool call by name. Always returns a string (never throws).
async function executeTool(name, args) {
  // Connector tools are namespaced "<id>__<tool>".
  if (name.includes('__') && mcpClient) {
    try { return await runMcpTool(name, args); }
    catch (e) { return `Tool ${name} error: ${e.message}`; }
  }
  const tool = TOOLS[name];
  if (!tool) return `Unknown tool: ${name}`;
  try {
    return await tool.run(args || {});
  } catch (e) {
    return `Tool ${name} error: ${e.message}`;
  }
}

const ALL_TOOL_NAMES = Object.keys(TOOLS);

module.exports = { getToolDefinitions, executeTool, ALL_TOOL_NAMES, runFetchUrl };
