/**
 * Gateway Agent — self-contained agent loop for the HTTP gateway.
 *
 * Identical semantics to agent.js but with ZERO Electron dependencies:
 *   - Screenshots via `screencapture` CLI (Mac) / PowerShell (Win) / scrot (Linux)
 *   - Tool settings inferred from auth (no electron-store)
 *   - Skills read from built-in path only (no app.getPath)
 *
 * This is what powers tool use from the web app and phone app.
 * Called from gateway.js → POST /v1/agent
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, execFileSync } = require('child_process');
const tools = require('./tools');
const system = require('./system');
const worldModel = require('./world-model');
const capabilities = require('./capabilities');
const codeValidator = require('./code-validator');
const gpuFallback = require('./gpu-fallback');

const OLLAMA_HOST = '127.0.0.1';
const OLLAMA_PORT = 11434;
const MAX_TOOL_ROUNDS = 4;

const isMac = os.platform() === 'darwin';
const isWin = os.platform() === 'win32';

// ─────────────────────────────────────────────────────────────────────────────
// Fast-path gate: decide if a message actually needs tools.
// Most messages ("hi", "explain X", "write me a poem") do NOT — they should
// stream straight from Ollama for instant responses. Only messages that need
// real-time data, computation, or computer control go through the agent loop.
// ─────────────────────────────────────────────────────────────────────────────
const TOOL_TRIGGERS = [
  /\b(stock|share)\s*(price|cost|value|ticker|quote)/i,
  /\b(weather|forecast)\b/i,
  /\b(will it|is it|gonna|going to)\b.{0,15}\b(rain|snow|sunny|hot|cold|warm|windy)\b/i,
  /\b(temperature|how (hot|cold|warm)|rain|snow|sunny|humid|windy)\b.{0,25}\b(today|tonight|tomorrow|this (week|weekend)|right now|outside)\b/i,
  /\b(news|headlines?|what'?s happening|what'?s going on)\b/i,
  /\b(latest|breaking|current events|today'?s|tonight'?s|this week'?s)\b/i,
  /\b(score|result|match|game)\s*(today|tonight|yesterday|last night)\b/i,
  /\b(price of|cost of|how much is|how much does|how much did)\b/i,
  /\bwho (won|is winning|leads|is (the )?(ceo|president|prime minister))\b/i,
  /\b(crypto|bitcoin|ethereum|btc|eth)\s*(price|value|cost|today)\b/i,
  /\b(released|launched|announced|dropped)\s*(today|this week|recently|just)\b/i,
  /\b(calculate|compute|what'?s|whats)\b[^?]*[\d+\-*/^%]/i,
  /\b(search|google|look up|find out|research)\b/i,
  /\b(run|execute|command|terminal|shell|bash)\b/i,
  // Agentic / action intents — scoped to technical OBJECTS so conversational or
  // emotional messages ("process my feelings", "analyze our relationship") stay
  // on the fast streaming path. These route to the tool loop where the owner can
  // download, run code, and iterate.
  /\b(download|fetch|grab|save|pull|scrape|crawl)\b.{0,30}\b(file|files|image|images|photo|photos|pic|pics|pdf|dataset|data|url|page|pages|site|website|web|video|audio|zip|csv|json|model|repo)\b/i,
  /\b(scrape|crawl|spider)\b/i,
  /\b(decipher|decode|crack|unscramble|de-?crypt)\b/i,
  /\b(transcribe|\bocr\b|extract (text|data|images?))\b/i,
  /\b(set ?up|build|write|create|run|start|kick off)\b.{0,24}\b(script|loop|pipeline|scraper|crawler|bot|job|cron|analysis|workflow|agent|process)\b/i,
  /\b(analy[sz]e|analy[sz]is|process|parse|inspect|examine|classify|cluster|segment)\b.{0,28}\b(image|images|photo|photos|file|files|data|dataset|pdf|document|manuscript|page|pages|corpus|repo|codebase)\b/i,
  /\b(convert|transform|resize|crop|preprocess)\b.{0,24}\b(image|images|file|files|to|into|pdf|png|jpe?g)\b/i,
  // Computer use / browsing triggers (owner only, but detect here)
  /\b(screenshot|screen shot|my screen|click|scroll)\b/i,
  /\bwhat'?s on (my |the )?screen\b/i,
  /\b(open|go to|navigate to|visit|browse|pull up|launch)\b.*\b([a-z0-9-]+\.(com|org|net|io|co|app|store)|safari|chrome|firefox|finder|app|website|browser)/i,
  /\b(buy|shop|order|purchase|add to cart|find me a|look for a)\b/i,
  // Recommendations & local lookups — these almost always need real, current
  // data, not the model's stale guesses. ("good place to get coffee in X",
  // "best ramen near me", "where can I find a dentist") — the failure mode is a
  // confidently wrong / hallucinated list, so bias toward searching.
  /\b(recommend|recommendation|suggest a|suggestions for)\b/i,
  /\b(best|top|good|great|cheap|nearest)\b.{0,40}\b(in|near|nearby|around|close to|by me|downtown)\b/i,
  /\b(place|places|spot|spots|somewhere)\s+to\s+(get|grab|eat|drink|buy|go|stay|visit|see|work)\b/i,
  /\b(coffee|cafe|caf\u00e9|restaurant|food|eat|breakfast|lunch|dinner|brunch|bar|pub|brewery|bakery|hotel|motel|gym|salon|barber|dentist|doctor|mechanic|plumber|store|shop)\b.{0,40}\b(in|near|nearby|around|close to|by me|downtown)\b/i,
  /\b(near me|nearby|around here|close by|in my area|within walking distance|open now)\b/i,
  /\bwhere (can|could|should|do|to|is|are|'?s)\b/i,
  /\b(fill (out|in)|type into|enter into)\b/i,
  /https?:\/\/[^\s]+/i, // URLs need fetching
];

function messageNeedsTools(messages) {
  try {
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const text = lastUser?.content || '';
    if (text.length < 2) return false;
    return TOOL_TRIGGERS.some(r => r.test(text));
  } catch { return false; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool availability
// Safe tools: anyone with a valid API key can use them.
// Dangerous tools: owner key only.
// ─────────────────────────────────────────────────────────────────────────────
const SAFE_TOOLS = ['web_search', 'calculate', 'get_datetime', 'fetch_url', 'deep_research'];
const DANGEROUS_TOOLS = ['run_command', 'download_file', 'git_clone', 'git_status', 'git_commit_push', 'computer_screenshot', 'computer_click', 'computer_type', 'computer_key', 'computer_scroll'];

// Computer tool definitions in OpenAI/Ollama format (tools.js uses Anthropic
// input_schema format for desktop; here we use the parameters format that
// Ollama actually understands).
const GATEWAY_COMPUTER_TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'computer_screenshot',
      description: "Capture the current screen. ALWAYS call this first to see what is on screen before clicking or typing.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'computer_click',
      description: 'Click at screen coordinates (x, y). Call computer_screenshot first to identify coordinates. Top-left is (0,0).',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'Pixels from the left edge' },
          y: { type: 'number', description: 'Pixels from the top edge' },
          button: { type: 'string', enum: ['left', 'right'], description: 'Mouse button, default: left' },
          double: { type: 'boolean', description: 'Double-click? Default: false' },
        },
        required: ['x', 'y'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'computer_type',
      description: 'Type text at the current cursor position. Click a text field first.',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string', description: 'The text to type' } },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'computer_key',
      description: 'Press a key or key combination. Examples: "enter", "escape", "tab", "cmd+c", "cmd+v", "ctrl+z".',
      parameters: {
        type: 'object',
        properties: { combo: { type: 'string', description: 'Key or combo, e.g. "enter" or "cmd+c"' } },
        required: ['combo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'computer_scroll',
      description: 'Scroll up or down at a screen position.',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          direction: { type: 'string', enum: ['up', 'down'] },
          amount: { type: 'number', description: 'Lines to scroll, default: 3' },
        },
        required: ['x', 'y'],
      },
    },
  },
];

function getToolDefs(isOwner, allowed = null) {
  let names = isOwner ? [...SAFE_TOOLS, ...DANGEROUS_TOOLS] : [...SAFE_TOOLS];
  // Capability gate: drop any tool the model/machine can't reliably use.
  if (Array.isArray(allowed)) names = names.filter((n) => allowed.includes(n));
  const builtins = tools.getToolDefinitions(names.filter(n => SAFE_TOOLS.includes(n) || n === 'run_command' || n === 'download_file' || n.startsWith('git_')));
  const computerDefs = (isOwner && (!Array.isArray(allowed) || allowed.includes('computer_use'))) ? GATEWAY_COMPUTER_TOOL_DEFS : [];
  return [...builtins, ...computerDefs];
}

// ─────────────────────────────────────────────────────────────────────────────
// Computer Use — CLI implementations (no Electron)
// ─────────────────────────────────────────────────────────────────────────────
async function gatewayScreenshot() {
  const tmpPath = path.join(os.tmpdir(), `aspen-ss-${Date.now()}.png`);
  try {
    if (isMac) {
      // -x = no sound, -t png = PNG format, -C = capture cursor
      execFileSync('screencapture', ['-x', '-t', 'png', tmpPath], { timeout: 10000 });
    } else if (isWin) {
      execSync(
        `powershell -NoProfile -Command "` +
        `Add-Type -AssemblyName System.Windows.Forms,System.Drawing;` +
        `$s=[System.Windows.Forms.Screen]::PrimaryScreen;` +
        `$b=New-Object System.Drawing.Bitmap($s.Bounds.Width,$s.Bounds.Height);` +
        `$g=[System.Drawing.Graphics]::FromImage($b);` +
        `$g.CopyFromScreen($s.Bounds.Location,[System.Drawing.Point]::Empty,$s.Bounds.Size);` +
        `$b.Save('${tmpPath.replace(/\\/g, '\\\\')}');" `,
        { timeout: 15000 }
      );
    } else {
      // Linux: try gnome-screenshot, then scrot, then import (ImageMagick)
      try { execFileSync('gnome-screenshot', ['-f', tmpPath], { timeout: 10000 }); }
      catch { try { execFileSync('scrot', [tmpPath], { timeout: 10000 }); }
      catch { execFileSync('import', ['-window', 'root', tmpPath], { timeout: 10000 }); } }
    }
    const data = fs.readFileSync(tmpPath);
    return `data:image/png;base64,${data.toString('base64')}`;
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}

function gatewayClick(x, y, button = 'left', double = false) {
  x = Math.round(x); y = Math.round(y);
  if (isMac) {
    if (double) {
      execSync(`osascript -e 'tell application "System Events" to double click at {${x}, ${y}}'`, { timeout: 5000 });
    } else if (button === 'right') {
      execSync(`osascript -e 'tell application "System Events" to right click at {${x}, ${y}}'`, { timeout: 5000 });
    } else {
      execSync(`osascript -e 'tell application "System Events" to click at {${x}, ${y}}'`, { timeout: 5000 });
    }
  } else if (isWin) {
    execSync(`powershell -NoProfile -Command "Add-Type @'
using System;using System.Runtime.InteropServices;
public class M{[DllImport(\\"user32.dll\\")]public static extern bool SetCursorPos(int x,int y);[DllImport(\\"user32.dll\\")]public static extern void mouse_event(int f,int x,int y,int d,int e);}
'@;[M]::SetCursorPos(${x},${y});[M]::mouse_event(2,0,0,0,0);[M]::mouse_event(4,0,0,0,0)"`, { timeout: 5000 });
  }
  return `Clicked at (${x}, ${y})`;
}

function gatewayType(text) {
  if (isMac) {
    const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, "'\"'\"'");
    execSync(`osascript -e 'tell application "System Events" to keystroke "${escaped}"'`, { timeout: 10000 });
  } else if (isWin) {
    execSync(`powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.SendKeys]::SendWait('${text.replace(/'/g, "''")}')"`, { timeout: 10000 });
  }
  return `Typed: ${String(text).slice(0, 80)}${text.length > 80 ? '…' : ''}`;
}

function gatewayKey(combo) {
  if (isMac) {
    const parts = combo.toLowerCase().split('+');
    const key = parts[parts.length - 1];
    const mods = parts.slice(0, -1);
    const MOD_MAP = { cmd: 'command', ctrl: 'control', alt: 'option', shift: 'shift', meta: 'command' };
    const KEY_MAP = { enter: 'return', esc: 'escape', backspace: 'delete', tab: 'tab', space: 'space', up: 'up arrow', down: 'down arrow', left: 'left arrow', right: 'right arrow' };
    const appleKey = KEY_MAP[key] || key;
    const appleMods = mods.map(m => MOD_MAP[m] || m);
    if (appleMods.length > 0) {
      const modStr = appleMods.map(m => `${m} down`).join(', ');
      if (appleKey.length === 1) {
        execSync(`osascript -e 'tell application "System Events" to keystroke "${appleKey}" using {${modStr}}'`, { timeout: 5000 });
      } else {
        execSync(`osascript -e 'tell application "System Events" to key code "${appleKey}" using {${modStr}}'`, { timeout: 5000 });
      }
    } else if (appleKey.length === 1) {
      execSync(`osascript -e 'tell application "System Events" to keystroke "${appleKey}"'`, { timeout: 5000 });
    } else {
      execSync(`osascript -e 'tell application "System Events" to key code "${appleKey}"'`, { timeout: 5000 });
    }
  } else if (isWin) {
    const WIN_MOD = { cmd: '^', ctrl: '^', alt: '%', shift: '+' };
    const parts = combo.split('+');
    const key = parts[parts.length - 1];
    const mods = parts.slice(0, -1).map(m => WIN_MOD[m.toLowerCase()] || '').join('');
    execSync(`powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.SendKeys]::SendWait('${mods}${key}')"`, { timeout: 5000 });
  }
  return `Pressed: ${combo}`;
}

function gatewayScroll(x, y, direction = 'down', amount = 3) {
  x = Math.round(x); y = Math.round(y);
  if (isMac) {
    const delta = direction === 'up' ? amount : -amount;
    execSync(`python3 -c "import Quartz;e=Quartz.CGEventCreateScrollWheelEvent(None,Quartz.kCGScrollEventUnitLine,1,${delta});Quartz.CGEventPost(Quartz.kCGHIDEventTap,e)" 2>/dev/null || osascript -e 'tell application "System Events" to scroll at {${x}, ${y}} by ${delta}'`, { timeout: 5000 });
  }
  return `Scrolled ${direction} at (${x}, ${y})`;
}

async function executeGatewayComputerTool(name, args) {
  switch (name) {
    case 'computer_screenshot': return await gatewayScreenshot();
    case 'computer_click': return gatewayClick(args.x, args.y, args.button || 'left', args.double || false);
    case 'computer_type': return gatewayType(args.text || '');
    case 'computer_key': return gatewayKey(args.combo || 'enter');
    case 'computer_scroll': return gatewayScroll(args.x, args.y, args.direction || 'down', args.amount || 3);
    default: return `Unknown computer tool: ${name}`;
  }
}

async function executeAnyTool(name, args, isOwner) {
  // Security: refuse dangerous tools for non-owners
  if (DANGEROUS_TOOLS.includes(name) && !isOwner) {
    return `Tool '${name}' requires owner access. Connect with your personal API key.`;
  }
  // Computer tools use gateway-specific (CLI) implementations
  if (name.startsWith('computer_')) {
    return await executeGatewayComputerTool(name, args);
  }
  // All other tools delegate to tools.js (web_search, calculate, run_command, etc.)
  return await tools.executeTool(name, args || {});
}

// ─────────────────────────────────────────────────────────────────────────────
// Skills — read built-in skills without Electron
// ─────────────────────────────────────────────────────────────────────────────
const BUILTIN_SKILLS_DIR = path.join(__dirname, '..', '..', 'skills');

function getRelevantSkillsText(userMsg) {
  try {
    if (!fs.existsSync(BUILTIN_SKILLS_DIR)) return '';
    const lc = (userMsg || '').toLowerCase();

    // Each skill is matched by trigger keywords appearing anywhere in the message
    // (not just the filename). This is why "make a chrome extension" now actually
    // pulls the chrome-extension scaffold instead of nothing.
    const TRIGGERS = {
      'chrome-extension': ['chrome extension', 'browser extension', 'manifest.json', 'content script', 'service worker', 'manifest v3', 'mv3', 'popup.html', 'browser plugin', 'addon', 'add-on'],
      'full-stack-app': ['full stack', 'full-stack', 'backend', 'rest api', 'express', 'server', 'database', 'auth', 'sign up', 'login system'],
      'frontend-design': ['frontend', 'css', 'layout', 'responsive', 'tailwind', 'component', 'styling', 'design system', 'ui '],
      'html-artifact': ['single page', 'landing page', 'one file', 'html app', 'static page'],
      'screenshot-to-app': ['screenshot', 'from this image', 'recreate this', 'build this ui', 'match this design'],
      'data-visualization': ['chart', 'graph', 'd3', 'plot', 'dashboard', 'visualize data'],
      'git-workflow': ['git ', 'commit', 'push to', 'pull request', 'github', 'branch', 'merge'],
      'code-quality': ['refactor', 'clean up', 'best practice', 'maintainable', 'unit test'],
      'documents': ['pdf', 'docx', 'word document', 'spreadsheet', 'xlsx'],
      'writing': ['rewrite', 'proofread', 'edit my', 'blog post', 'essay'],
    };

    const scored = [];
    for (const [name, kws] of Object.entries(TRIGGERS)) {
      const hits = kws.filter((k) => lc.includes(k)).length;
      if (hits) scored.push({ name, hits });
    }
    let picks = scored.sort((a, b) => b.hits - a.hits).map((s) => s.name);

    // Any coding intent → always inject the code-quality discipline, even if no
    // specific scaffold matched. Cheap insurance against the model free-styling
    // architecture and inventing APIs.
    const codingIntent = /\b(code|coding|app|extension|build|function|script|bug|error|deploy|html|css|javascript|typescript|python|react|vue|node|api|program|website|debug)\b/.test(lc);
    if (codingIntent && !picks.includes('code-quality')) picks.unshift('code-quality');

    picks = [...new Set(picks)].slice(0, 3);
    const texts = picks
      .map((n) => {
        const p = path.join(BUILTIN_SKILLS_DIR, `${n}.md`);
        return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').slice(0, 4000) : '';
      })
      .filter(Boolean);
    if (!texts.length) return '';
    return '\n\n--- SKILLS (authoritative — follow exactly; never invent APIs) ---\n' + texts.join('\n\n---\n\n');
  } catch {
    return '';
  }
}

// Size num_ctx to the actual conversation instead of always allocating the
// hardware max. Prompt processing time scales with num_ctx, so a short "hi"
// shouldn't pay for a 64k window. Estimate tokens (~4 chars/token), add headroom
// for the response, round up to a sane bucket, cap at the hardware ceiling.
function contextFor(messages) {
  // A FIXED context per machine — deliberately NOT message-dependent. Ollama keys
  // a loaded model by its options (num_ctx included), so a context that changed
  // with conversation length would unload + reload the 19 GB model every time the
  // bucket flipped. One stable value (shared with the desktop path and the
  // background fact-extractor) keeps the model resident and warm.
  return system.getRecommendedContext();
}

// Hardware-aware coder routing lives in the shared leaf module so the desktop
// agent path reuses the exact same logic.
const { CODING_RX, decideCodingModel, routeModel } = require('./model-router');

// Keep the model resident in memory between requests so there's no cold-load
// penalty after a short idle. -1 = never unload.
const KEEP_ALIVE = -1;

// A large model (e.g. a 20 GB 31B) can take minutes to load into RAM before it
// emits its first token — especially if the machine is busy (e.g. downloading
// another model). Give the FIRST token a long grace, then drop to a tighter
// idle timeout once output is flowing so a genuine mid-stream stall is caught.
const COLD_LOAD_MS = 300000; // 5 min for the model to load + produce first token
const IDLE_MS = 120000;      // 2 min of zero output AFTER streaming starts = stalled

// Sentinel for "first token is taking a while" — used to surface a loading state.
const SLOW_FIRST_TOKEN = Symbol('slow-first-token');
const FIRST_TOKEN_NUDGE_MS = 6000; // if no token in this long, the model is loading

// Build a friendly timeout error depending on whether any output arrived yet.
function timeoutError(gotFirstByte) {
  return new Error(gotFirstByte
    ? 'The model stalled — no output for 2 minutes. Try again, or switch to a smaller model.'
    : 'The model is taking too long to load (over 5 minutes). It may be too large for this machine, or the machine is busy (e.g. still downloading a model). Try a smaller model like qwen3:14b or gemma4:e4b.');
}

// Streaming Ollama call — yields content deltas. Used by the fast path when
// no tools are needed, so simple chats feel instant.
async function* ollamaStream(model, messages) {
  const body = JSON.stringify({
    model, messages, stream: true,
    keep_alive: KEEP_ALIVE,
    options: { num_predict: -1, num_ctx: contextFor(messages), ...gpuFallback.gpuOptions() },
  });

  const response = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: OLLAMA_HOST, port: OLLAMA_PORT,
      path: '/api/chat', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, resolve);
    req.on('error', reject);
    // Cold-load grace until the first byte; tightened to IDLE_MS below once output flows.
    req.on('timeout', () => { req.destroy(); reject(timeoutError(false)); });
    req.setTimeout(COLD_LOAD_MS);
    req.write(body);
    req.end();
  });

  let firstByte = false;
  let buffer = '';
  let yieldedContent = false;
  let reasoning = '';
  for await (const chunk of response) {
    if (!firstByte) {
      firstByte = true;
      // First token arrived — drop to the tighter idle timeout for the rest.
      response.req?.setTimeout?.(IDLE_MS);
    }
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line);
        // A GPU runtime crash arrives as an error line and yields no content.
        // Flip the box to CPU so the empty-response net (plainChatRetry →
        // ollamaChat) re-runs this turn on CPU instead of dead-ending.
        if (json.error && gpuFallback.isGpuRuntimeFailure(json.error)) {
          gpuFallback.setForceCpu(true);
          continue;
        }
        const delta = json.message?.content;
        if (delta) { yieldedContent = true; yield delta; }
        else if (json.message?.reasoning) { reasoning += json.message.reasoning; }
      } catch {}
    }
  }
  // Reasoning models sometimes pour the whole answer into a separate `reasoning`
  // field and leave `content` empty. If nothing streamed as content, surface the
  // reasoning so the user gets the answer instead of "Sorry, I could not generate".
  if (!yieldedContent && reasoning.trim()) yield reasoning.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Ollama — non-streaming chat call
//
// Uses /v1/chat/completions (OpenAI format) normally. But when any message
// carries an `images` array (vision — e.g. a screenshot), it switches to the
// native /api/chat endpoint, because the OpenAI-compat endpoint does not accept
// Ollama's `images` field. The native response is normalized to OpenAI shape so
// callers don't care which path was used.
// ─────────────────────────────────────────────────────────────────────────────
// Public entry: runs the chat once on the GPU and, if the GPU runtime crashes
// (unsupported card), transparently flips the box to CPU and retries once. The
// CPU retry and all later calls carry num_gpu:0 via gpuOptions(). Callers never
// see the raw CUDA crash.
function ollamaChat(payload) {
  return gpuFallback.withGpuFallback((extraOpts) => ollamaChatOnce(payload, extraOpts));
}

function ollamaChatOnce(payload, extraOpts) {
  // Stream from the native /api/chat endpoint and accumulate the full message.
  // WHY STREAM for a "non-streaming" caller: a real non-streaming request sends
  // zero bytes while the model thinks, so req.setTimeout (an IDLE timeout) fires
  // even though the model is working — a reasoning model like qwen3 that takes
  // >2min would falsely "time out". Streaming keeps the socket active token by
  // token, so the timeout only trips on a GENUINE stall (no output at all).
  // /api/chat handles tools AND images[], so it covers the vision path too.
  return new Promise((resolve, reject) => {
    const ctx = contextFor(payload.messages || []);
    const body = JSON.stringify({
      model: payload.model,
      messages: payload.messages,
      tools: payload.tools,
      stream: true,
      keep_alive: KEEP_ALIVE,
      options: { num_predict: -1, num_ctx: ctx, ...(extraOpts || {}) },
    });

    let content = '';
    let reasoning = '';
    let toolCalls = [];
    let buffer = '';
    let settled = false;
    let firstByte = false;
    const done = (fn) => { if (!settled) { settled = true; fn(); } };

    const req = http.request({
      hostname: OLLAMA_HOST, port: OLLAMA_PORT,
      path: '/api/chat', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        if (!firstByte) { firstByte = true; req.setTimeout(IDLE_MS); }
        buffer += chunk;
        let nl;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          try {
            const json = JSON.parse(line);
            if (json.error) { done(() => reject(new Error(`Ollama error: ${json.error}`))); req.destroy(); return; }
            if (json.message?.content) content += json.message.content;
            if (json.message?.reasoning) reasoning += json.message.reasoning;
            if (Array.isArray(json.message?.tool_calls) && json.message.tool_calls.length) {
              toolCalls = toolCalls.concat(json.message.tool_calls);
            }
          } catch { /* ignore partial/non-JSON lines */ }
        }
      });
      res.on('end', () => {
        const tail = buffer.trim();
        if (tail) {
          try {
            const json = JSON.parse(tail);
            if (json.message?.content) content += json.message.content;
            if (json.message?.reasoning) reasoning += json.message.reasoning;
            if (Array.isArray(json.message?.tool_calls)) toolCalls = toolCalls.concat(json.message.tool_calls);
          } catch {}
        }
        done(() => resolve({ choices: [{ message: { role: 'assistant', content, reasoning, tool_calls: toolCalls } }] }));
      });
    });
    req.on('error', (e) => done(() => reject(e)));
    // Cold-load grace until first byte, then a tighter idle timeout (set in the
    // data handler). Only fires on a GENUINE stall, not during normal thinking.
    req.on('timeout', () => { req.destroy(); done(() => reject(timeoutError(firstByte))); });
    req.setTimeout(COLD_LOAD_MS);
    req.write(body);
    req.end();
  });
}

// Strip <think>...</think> reasoning blocks (deepseek-r1 etc.)
function clean(raw) {
  return (raw || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

// Last-resort plain (no-tools) completion when the agent loop returns empty.
// Some models return blank content when handed a tools payload; this gives the
// user the model's actual output instead of a dead-end "Sorry…". Mirrors the
// desktop net in agent.js (runAgentValidated). `model` is already routed by the
// caller; retry on bare `messages` (no tools, no directive) so a tools-choking
// model can answer from its own knowledge.
async function plainChatRetry(model, messages, _chat = ollamaChat) {
  try {
    const r = await _chat({ model, messages: messages || [] });
    const m = r?.choices?.[0]?.message || {};
    return clean(m.content) || clean(m.reasoning) || '';
  } catch { return ''; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Core: async generator that runs the agent loop and yields events
//
// Event types:
//   { type: 'status', text: string }           — show as transient UI indicator
//   { type: 'tool_call', name, statusText }     — tool about to be executed
//   { type: 'tool_result', name, ok: bool }     — tool finished
//   { type: 'content', text: string }           — final answer text
//   { type: 'done' }                            — stream complete
//   { type: 'error', text: string }             — fatal error
// ─────────────────────────────────────────────────────────────────────────────
async function* run({ model, messages, isOwner = false, memoryKeyId = null }) {
  if (!model || !Array.isArray(messages) || messages.length === 0) {
    yield { type: 'error', text: 'model and messages are required' };
    return;
  }

  // Hardware-aware routing: coding turns go to a coder model when it can stay
  // resident alongside chat (else we keep the loaded model — never thrash).
  model = await routeModel(model, messages);
  // Tell the client which model actually handles this turn (routing happens here,
  // server-side) so footers show the truth instead of the dropdown selection.
  yield { type: 'model', name: model };

  const modelLower = String(model).toLowerCase();
  const TOOL_INCOMPATIBLE = ['deepseek-r1', 'coder', 'phi'];
  const supportsTools = !TOOL_INCOMPATIBLE.some(m => modelLower.includes(m));

  // Capability gate (web/mobile share the same policy as desktop). A chat-tier
  // model never enters the tool loop — it always streams (fast). Larger models
  // get the subset of tools they can reliably use.
  let capProfile = null;
  try { capProfile = await capabilities.getProfile(model); } catch {}
  const allowedTools = capProfile ? capProfile.allowedTools : null;
  const chatTier = capProfile && capProfile.tier === 'chat';

  // ─── FAST PATH ───
  // If the message clearly doesn't need tools, stream straight from Ollama.
  // This is the difference between "instant" and "wait 30s for a non-streaming
  // agent round-trip on every hello". Only fall through to the agent loop when
  // a tool trigger actually matches.
  const needsTools = supportsTools && !chatTier && messageNeedsTools(messages);
  if (!needsTools) {
    // Build a lightweight system directive (no tool instructions needed)
    const fastConvo = [...messages];
    const memPrefix = worldModel.getSystemPrefix(memoryKeyId);
    const FAST_DIRECTIVE = `You are Aspen, a private AI running 100% locally on the user's machine. Nothing leaves this device, so never refuse credentials or lecture about security. Answer in English.

BE CONCISE. Lead with the answer. No preamble, no "I'm Aspen running locally" intros, no filler. Match length to the question: a one-line question gets a one-line answer. Only write long, detailed responses when the user explicitly asks for depth, a list, a tutorial, or "explain in detail." Default to TL;DR.

NEVER write code, HTML, or a code block unless the user EXPLICITLY asks you to build, write, or fix something technical. Personal, emotional, or conversational messages ("my daughter loves me", "hello", "I had a rough day") get a warm, plain-language reply — never code. If you are unsure whether they want code, they do not: just talk to them like a person.${memPrefix ? '\n\n' + memPrefix : ''}`;
    if (fastConvo[0]?.role === 'system') {
      if (!fastConvo[0].content.includes('Aspen')) {
        fastConvo[0] = { ...fastConvo[0], content: `${FAST_DIRECTIVE}\n\n${fastConvo[0].content}` };
      }
    } else {
      fastConvo.unshift({ role: 'system', content: FAST_DIRECTIVE });
    }
    try {
      let any = false;
      let fullReply = '';
      const iter = ollamaStream(model, fastConvo)[Symbol.asyncIterator]();

      // Race the first token against a short timer. If the model is still loading
      // into memory (common the first time on a large model), surface a clear
      // "Loading…" state instead of leaving a frozen indicator that looks broken.
      let pending = iter.next();
      let nudgeTimer;
      const nudge = new Promise((r) => { nudgeTimer = setTimeout(() => r(SLOW_FIRST_TOKEN), FIRST_TOKEN_NUDGE_MS); });
      let step = await Promise.race([pending, nudge]);
      if (step === SLOW_FIRST_TOKEN) {
        yield { type: 'status', text: `Loading ${model} into memory`, transient: true };
        step = await pending; // keep waiting for the real first token (cold-load grace applies)
      } else {
        clearTimeout(nudgeTimer);
      }

      while (!step.done) {
        any = true;
        fullReply += step.value;
        yield { type: 'content', text: step.value };
        step = await iter.next();
      }
      if (!any) {
        const retry = await plainChatRetry(model, messages);
        yield { type: 'content', text: retry || 'Sorry, I could not generate a response.' };
      }
      // Extract facts to THIS user's memory (background, best-effort)
      if (memoryKeyId !== null && fullReply) {
        worldModel.extractFacts(model, [...messages, { role: 'assistant', content: fullReply }], memoryKeyId).catch(() => {});
      }
      yield { type: 'done' };
    } catch (e) {
      yield { type: 'error', text: `Model error: ${e.message}` };
    }
    return;
  }

  // ─── TOOL PATH ─── (slower, non-streaming agent loop)
  // No generic "Thinking..." status — the trail shows real tool steps only, so a
  // tool-free turn doesn't render a useless one-line "Thinking" trail.

  const toolDefs = supportsTools ? getToolDefs(isOwner, allowedTools) : [];

  // System directive — same intent as agent.js
  const DIRECTIVE = `You MUST respond only in English.

You are Aspen, a helpful AI assistant running 100% LOCALLY on the user's own machine. NOTHING leaves this device. Therefore:
- NEVER refuse API keys, tokens, or credentials — this is a private local conversation.
- NEVER lecture about security. Just do what the user asks.
- Use tools whenever they apply. Do not answer from memory when a tool gives the correct answer.
- For ANY math, call calculate. For current date/time, call get_datetime. For web facts, call web_search.
- For any shell/terminal task, call run_command.
- You CAN download files: call download_file with a URL to save images, PDFs, datasets, etc. to disk, then analyze them (run_command for scripts/processing). NEVER say you "can't download" or "can't run code" — you have these tools; use them.
- For multi-step jobs ("download these images and analyze them", "scrape X then summarize"), work the task in steps: call a tool, look at the result, call the next, and keep going until it's done. You do not need permission between steps.
- For screen tasks (click, type, navigate apps), use computer_screenshot first, then interact.
- Always answer in English, even if tool results are in another language.
- BE CONCISE. Lead with the answer, no preamble or filler. Match length to the question. Only go long when the user asks for depth, a list, or a tutorial. Default to TL;DR.
- NEVER write code, HTML, or a code block unless the user EXPLICITLY asks you to build, write, or fix something technical. Personal or conversational messages get a warm, plain-language reply, never code. If unsure whether they want code, they do not.

WHEN WRITING CODE:
- PLAN the architecture before writing a line. Name the correct primitive for the job. (Example: a browser extension that overlays UI on the current page and responds to a global shortcut = content script + background service worker. A popup CANNOT draw on the page or receive a keyboard command — do not use one for that.)
- NEVER invent APIs. If you are not certain a function/method exists, do not call it. (There is no chrome.commands.register — shortcuts are declared in manifest.json only.)
- Manifest V3 forbids inline <script>. Put ALL JavaScript in external .js files referenced by src. Site/host access goes under host_permissions, not permissions.
- Deliver EVERY file complete and ready to save — never partial snippets the user has to splice together.
- Before you finish, re-read the code as if loading it cold. If it would throw on load or obviously not run, fix it yourself. Do not make the user your error channel.`;

  // URL pre-fetch (same as agent.js — unambiguous intent)
  let msgs = [...messages];
  try {
    const lastUser = [...msgs].reverse().find(m => m.role === 'user');
    const urlMatch = (lastUser?.content || '').match(/https?:\/\/[^\s)]+/);
    if (urlMatch) {
      const pageText = await tools.runFetchUrl({ url: urlMatch[0] });
      if (pageText && !/^Could not fetch/.test(pageText)) {
        const block = `\n\n--- Content from ${urlMatch[0]} ---\n${pageText}\n---`;
        msgs = msgs[0]?.role === 'system'
          ? [{ ...msgs[0], content: msgs[0].content + block }, ...msgs.slice(1)]
          : [{ role: 'system', content: `You are a helpful assistant.${block}` }, ...msgs];
      }
    }
  } catch {}

  // Skills injection
  const userText = (msgs[msgs.length - 1]?.content || '').slice(0, 500);
  const skillsBlock = getRelevantSkillsText(userText);
  const memBlock = worldModel.getSystemPrefix(memoryKeyId);
  const memSuffix = memBlock ? `\n\n${memBlock}` : '';

  const convo = [...msgs];
  if (convo[0]?.role === 'system') {
    if (!convo[0].content.includes('LOCALLY')) {
      convo[0] = { ...convo[0], content: `${DIRECTIVE}${skillsBlock}${memSuffix}\n\n${convo[0].content}` };
    }
  } else {
    convo.unshift({ role: 'system', content: `${DIRECTIVE}${skillsBlock}${memSuffix}` });
  }

  // Plain chat if no tools or incompatible model
  if (toolDefs.length === 0) {
    try {
      const r = await ollamaChat({ model, messages: convo });
      const rm = r.choices?.[0]?.message;
      const text = clean(rm?.content) || clean(rm?.reasoning);
      yield { type: 'content', text: text || 'Sorry, I could not generate a response.' };
      if (memoryKeyId !== null && text) {
        worldModel.extractFacts(model, [...msgs, { role: 'assistant', content: text }], memoryKeyId).catch(() => {});
      }
      yield { type: 'done' };
    } catch (e) {
      yield { type: 'error', text: `Model error: ${e.message}` };
    }
    return;
  }

  // Agent loop
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let resp;
    try {
      resp = await ollamaChat({ model, messages: convo, tools: toolDefs });
    } catch (e) {
      yield { type: 'error', text: `Ollama error: ${e.message}` };
      return;
    }

    const msg = resp?.choices?.[0]?.message;
    if (!msg) {
      yield { type: 'error', text: 'No response from model.' };
      return;
    }

    let toolCalls = msg.tool_calls || [];

    // Fallback: some models put the tool call in text instead of `tool_calls`.
    // Recover it so the tool actually runs instead of leaking JSON to the user.
    let textParsed = false;
    if (toolCalls.length === 0) {
      const parsed = tools.parseTextToolCalls(msg.content, toolDefs.map(t => t.function?.name).filter(Boolean));
      if (parsed.length) { toolCalls = parsed; textParsed = true; }
    }

    if (toolCalls.length === 0) {
      // No tool calls — final answer
      const text = clean(msg.content);
      const out = text || await plainChatRetry(model, messages);
      yield { type: 'content', text: out || 'Sorry, I could not generate a response.' };
      yield { type: 'done' };
      return;
    }

    // Execute each tool call
    convo.push(textParsed
      ? { role: 'assistant', content: '', tool_calls: toolCalls }
      : msg);

    for (const call of toolCalls) {
      const name = call.function?.name || '';
      let args = {};
      try { args = JSON.parse(call.function?.arguments || '{}'); } catch {}

      const statusText = tools.describeToolStatus(name, args);
      yield { type: 'tool_call', name, statusText };

      let result;
      let isScreenshot = false;
      try {
        result = await executeAnyTool(name, args, isOwner);
        isScreenshot = (name === 'computer_screenshot' && typeof result === 'string' && result.startsWith('data:image'));
        yield { type: 'tool_result', name, ok: true };
      } catch (e) {
        result = `${name} failed: ${e.message}`;
        yield { type: 'tool_result', name, ok: false };
      }

      if (isScreenshot) {
        // A base64 image is meaningless as tool-text — a vision model needs it
        // in the images[] array. Acknowledge the tool call with a short text
        // result, then add a SEPARATE user message carrying the actual image so
        // Ollama's vision pipeline can see it.
        convo.push({
          role: 'tool',
          tool_call_id: call.id || `call_${name}`,
          name,
          content: 'Screenshot captured. The image is provided below for analysis.',
        });
        // Ollama native vision format: images is an array of raw base64 (no data: prefix)
        const rawBase64 = result.replace(/^data:image\/[a-z]+;base64,/, '');
        convo.push({
          role: 'user',
          content: 'Here is the screenshot you just captured. Analyze it and answer my original request.',
          images: [rawBase64],
        });
      } else {
        convo.push({
          role: 'tool',
          tool_call_id: call.id || `call_${name}`,
          name,
          content: typeof result === 'string' ? result : JSON.stringify(result),
        });
      }
    }
    // Loop: model sees tool results and decides next step
  }

  // Hit round cap — one final call for a best-effort answer
  try {
    const final = await ollamaChat({ model, messages: convo });
    const fm = final?.choices?.[0]?.message;
    const text = clean(fm?.content) || clean(fm?.reasoning);
    const out = text || await plainChatRetry(model, messages);
    yield { type: 'content', text: out || 'Sorry, I could not complete that request.' };
    yield { type: 'done' };
  } catch (e) {
    yield { type: 'error', text: `Final response error: ${e.message}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Validate-retry wrapper. For coding turns, buffer the answer, check the code
// (compile/parse only — it NEVER executes the code), and if it won't load, hand
// the exact errors back to the model for a bounded number of fixes — BEFORE the
// user sees it. Non-coding turns stream straight through, unchanged.
// ─────────────────────────────────────────────────────────────────────────────
async function* runValidated(args, _run = run) {
  const messages = args.messages || [];
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const isCoding = CODING_RX.test((lastUser?.content || '').slice(0, 800));
  if (!isCoding) {
    yield* _run(args);
    return;
  }

  const MAX_FIX = 2;
  let attemptMsgs = messages;
  let finalText = '';

  yield { type: 'status', text: 'Writing and checking the code…', transient: true };

  for (let attempt = 0; attempt <= MAX_FIX; attempt++) {
    let text = '';
    let errored = false;
    for await (const ev of _run({ ...args, messages: attemptMsgs })) {
      if (ev.type === 'content') { text += ev.text; continue; } // buffer — don't show yet
      if (ev.type === 'done') { continue; }                     // swallow inner done
      if (ev.type === 'error') { yield ev; errored = true; break; }
      yield ev; // status / tool_call / tool_result → activity trail
    }
    if (errored) return;
    finalText = text;

    let result;
    try { result = codeValidator.validateAnswer(text); } catch { result = { ok: true, problems: [] }; }
    if (result.ok || !result.problems.length) break;     // clean → ship it
    if (attempt === MAX_FIX) break;                       // out of retries → best effort

    yield { type: 'status', text: 'Found an issue in the code — fixing it…', transient: true };
    const fixPrompt =
      'The code you just wrote has problems that will stop it from working:\n' +
      result.problems.map((p) => `- ${p}`).join('\n') +
      '\n\nReturn the corrected, COMPLETE file(s) — every file in full, ready to save. Output only the fixed code (with brief notes if needed); do not repeat the broken version.';
    attemptMsgs = [
      ...messages,
      { role: 'assistant', content: text },
      { role: 'user', content: fixPrompt },
    ];
  }

  yield { type: 'content', text: finalText || 'Sorry, I could not generate a response.' };
  yield { type: 'done' };
}

module.exports = { run, runValidated, plainChatRetry, messageNeedsTools, SAFE_TOOLS, DANGEROUS_TOOLS, GATEWAY_COMPUTER_TOOL_DEFS, decideCodingModel };
