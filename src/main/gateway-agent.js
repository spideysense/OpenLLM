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
const { makeArtifactFencer } = require('./artifact-fence');
const { ASPEN_ABOUT } = require('./aspen-facts');
const system = require('./system');
const worldModel = require('./world-model');
const capabilities = require('./capabilities');
const codeValidator = require('./code-validator');
const gpuFallback = require('./gpu-fallback');
const modelDebug = require('./model-debug');

const OLLAMA_HOST = '127.0.0.1';
const OLLAMA_PORT = 11434;
const { parseToolArgs } = require('./tool-args');
const MAX_TOOL_ROUNDS = 4;
// Owner agentic tasks (download N files, run scripts, inspect, refine) need more
// iterations than a one-shot lookup. Local models are free to run, so a deeper
// loop costs only time. Bounded to avoid a runaway. Tool path only — never the
// streaming fast path.
const OWNER_MAX_TOOL_ROUNDS = 16;

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
    const userMsgs = messages.filter(m => m.role === 'user');
    const text = userMsgs[userMsgs.length - 1]?.content || '';
    if (text.length < 2) return false;
    if (TOOL_TRIGGERS.some(r => r.test(text))) return true;
    // Clarification turn: "weather in Hillsborough?" -> "which one?" -> "California".
    // The short reply has no trigger word, but the prior turn did. Don't drop the
    // tool intent just because the user answered tersely.
    const prev = userMsgs[userMsgs.length - 2]?.content || '';
    const isShort = text.trim().split(/\s+/).length <= 4;
    // ...but not if the short reply is just an acknowledgment ("thanks", "ok cool").
    const isAck = /^(thanks?|thank you|ok(ay)?|cool|great|nice|got it|perfect|awesome|sounds good|no|nope|yes|yeah|yep)\b/i.test(text.trim());
    if (isShort && !isAck && prev && TOOL_TRIGGERS.some(r => r.test(prev))) return true;
    return false;
  } catch { return false; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool availability
// Safe tools: anyone with a valid API key can use them.
// Dangerous tools: owner key only.
// ─────────────────────────────────────────────────────────────────────────────
const SAFE_TOOLS = ['web_search', 'find_image', 'calculate', 'get_datetime', 'fetch_url', 'deep_research'];
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


function getToolDefs(isOwner, allowed = null, allowComputer = false) {
  let names = isOwner ? [...SAFE_TOOLS, ...DANGEROUS_TOOLS] : [...SAFE_TOOLS];
  // Capability gate: drop any tool the model/machine can't reliably use.
  if (Array.isArray(allowed)) names = names.filter((n) => allowed.includes(n));
  const builtins = tools.getToolDefinitions(names.filter(n => SAFE_TOOLS.includes(n) || n === 'run_command' || n === 'download_file' || n.startsWith('git_')));
  // Computer use (screenshot/click on THIS machine) is OFF unless explicitly opted in.
  // A remote phone/web chat must never get it: 'weather here' should search the web,
  // not screenshot the box and dump 6 MB into context.
  const computerDefs = (allowComputer && isOwner && (!Array.isArray(allowed) || allowed.includes('computer_use'))) ? GATEWAY_COMPUTER_TOOL_DEFS : [];
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

// Qwen3.x / GLM-5 / deepseek-r1 etc. emit a chain-of-thought trace by default.
// That trace (a) breaks tool-call JSON — the model reasons instead of emitting a
// clean call — and (b) slows streaming, since the user waits through reasoning
// tokens before the answer. Disable it via Ollama's native `think` flag. CRUCIAL:
// only send `think` for models that actually support thinking — passing it to a
// non-thinking model (e.g. llama4:scout) can error. So scout's request body is
// left byte-for-byte unchanged; only thinking models get think:false.
const THINKING_MODELS = /qwen3|glm-?5|deepseek-r1|magistral|cogito|minimax-m/i;
function thinkOpt(model) {
  return THINKING_MODELS.test(String(model || '')) ? { think: false } : {};
}

// Streaming Ollama call — yields content deltas. Used by the fast path when
// no tools are needed, so simple chats feel instant.
async function* ollamaStream(model, messages) {
  const body = JSON.stringify({
    model, messages, stream: true,
    keep_alive: KEEP_ALIVE,
    ...thinkOpt(model),
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
        else if (json.message?.thinking) { reasoning += json.message.thinking; } // qwen3/glm native field
      } catch {}
    }
  }
  // Reasoning models sometimes pour the whole answer into a separate `reasoning`
  // field and leave `content` empty. If nothing streamed as content, surface the
  // reasoning so the user gets the answer instead of "Sorry, I could not generate".
  if (!yieldedContent && reasoning.trim()) yield reasoning.trim();
}

// Streaming Ollama call WITH tools attached. Yields tagged events:
//   { kind: 'content', text }  — a content delta (stream it straight through)
//   { kind: 'tools', calls }   — the model decided to call tools (emitted once,
//                                at end of stream, with the accumulated calls)
// This is the heart of the unified path: tools are always attached, and the
// MODEL decides. A conversational turn streams content and never emits a tool
// call (instant, same feel as the old fast path); an action turn emits a tool
// call which the caller narrates + executes. No regex routing.
async function* ollamaStreamTools(model, messages, toolDefs) {
  const body = JSON.stringify({
    model, messages, stream: true,
    keep_alive: KEEP_ALIVE,
    ...thinkOpt(model),
    ...(Array.isArray(toolDefs) && toolDefs.length ? { tools: toolDefs } : {}),
    options: { num_predict: -1, num_ctx: contextFor(messages), ...gpuFallback.gpuOptions() },
  });

  const response = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: OLLAMA_HOST, port: OLLAMA_PORT,
      path: '/api/chat', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, resolve);
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(timeoutError(false)); });
    req.setTimeout(COLD_LOAD_MS);
    req.write(body);
    req.end();
  });

  let firstByte = false;
  let buffer = '';
  let yieldedContent = false;
  let reasoning = '';
  let toolCalls = [];
  for await (const chunk of response) {
    if (!firstByte) { firstByte = true; response.req?.setTimeout?.(IDLE_MS); }
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line);
        if (json.error && gpuFallback.isGpuRuntimeFailure(json.error)) { gpuFallback.setForceCpu(true); continue; }
        const delta = json.message?.content;
        if (delta) { yieldedContent = true; yield { kind: 'content', text: delta }; }
        else if (json.message?.reasoning) { reasoning += json.message.reasoning; }
        else if (json.message?.thinking) { reasoning += json.message.thinking; }
        if (Array.isArray(json.message?.tool_calls) && json.message.tool_calls.length) {
          toolCalls = toolCalls.concat(json.message.tool_calls);
        }
      } catch {}
    }
  }
  if (toolCalls.length) { yield { kind: 'tools', calls: toolCalls }; }
  else if (!yieldedContent && reasoning.trim()) { yield { kind: 'content', text: reasoning.trim() }; }
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
      ...thinkOpt(payload.model),
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
            if (json.message?.thinking) reasoning += json.message.thinking;
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
            if (json.message?.thinking) reasoning += json.message.thinking;
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
async function* runRaw({ model, messages, isOwner = false, memoryKeyId = null, allowComputerUse = false }) {
  if (!model || !Array.isArray(messages) || messages.length === 0) {
    yield { type: 'error', text: 'model and messages are required' };
    return;
  }

  // Coding turns may route to a coder; otherwise we keep the loaded model.
  model = await routeModel(model, messages);
  yield { type: 'model', name: model };

  const modelLower = String(model).toLowerCase();
  const TOOL_INCOMPATIBLE = ['deepseek-r1', 'coder', 'phi'];
  const supportsTools = !TOOL_INCOMPATIBLE.some(m => modelLower.includes(m));

  // Capability gate. A chat-tier model never gets tools; larger models get the
  // subset they can reliably use.
  let capProfile = null;
  try { capProfile = await capabilities.getProfile(model); } catch {}
  const allowedTools = capProfile ? capProfile.allowedTools : null;
  const chatTier = capProfile && capProfile.tier === 'chat';
  const memPrefix = worldModel.getSystemPrefix(memoryKeyId);

  const toolDefs = (supportsTools && !chatTier) ? getToolDefs(isOwner, allowedTools, allowComputerUse) : [];

  // ─── NO-TOOLS FAST PATH ───
  // Chat-tier / tool-incompatible / small models can't use tools, so stream
  // straight from Ollama. Instant, unchanged.
  if (toolDefs.length === 0) {
    const fastConvo = [...messages];
    const FAST_DIRECTIVE = `You are Aspen, a private AI running 100% locally on the user's machine. Nothing leaves this device, so never refuse credentials or lecture about security. Answer in English.

BE CONCISE. Lead with the answer. No preamble, no "I'm Aspen running locally" intros, no filler. Match length to the question: a one-line question gets a one-line answer. Only write long, detailed responses when the user explicitly asks for depth, a list, a tutorial, or "explain in detail." Default to TL;DR.

NEVER write code, HTML, or a code block unless the user EXPLICITLY asks you to build, write, or fix something technical. Personal, emotional, or conversational messages ("my daughter loves me", "hello", "I had a rough day") get a warm, plain-language reply, never code. If you are unsure whether they want code, they do not: just talk to them like a person.

You CAN write code on request. NEVER tell the user you are "just a text-based model" or that you cannot code. That is false. You cannot fetch or display images in this mode — if asked to show a picture, say so honestly instead of pretending you showed one.\n\n${ASPEN_ABOUT}${memPrefix ? '\n\n' + memPrefix : ''}`;
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
      const reqCtx = contextFor(fastConvo);
      modelDebug.diagnose('fast', model, reqCtx).catch(() => {});
      const iter = ollamaStream(model, fastConvo)[Symbol.asyncIterator]();
      let pending = iter.next();
      let nudgeTimer;
      const nudge = new Promise((r) => { nudgeTimer = setTimeout(() => r(SLOW_FIRST_TOKEN), FIRST_TOKEN_NUDGE_MS); });
      let step = await Promise.race([pending, nudge]);
      if (step === SLOW_FIRST_TOKEN) {
        const d = await modelDebug.diagnose('fast-nudge', model, reqCtx);
        yield { type: 'status', text: d.resident ? 'Thinking…' : `Loading ${model} into memory`, transient: true };
        step = await pending;
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
        fullReply = retry || '';
      }
      if (memoryKeyId !== null && fullReply) {
        worldModel.extractFacts(model, [...messages, { role: 'assistant', content: fullReply }], memoryKeyId).catch(() => {});
      }
      yield { type: 'done' };
    } catch (e) {
      yield { type: 'error', text: `Model error: ${e.message}` };
    }
    return;
  }

  // ─── UNIFIED STREAMING + TOOLS PATH ───
  // One path for every tool-capable turn. Tools are ALWAYS attached and the
  // MODEL decides: a conversational turn streams an answer instantly and emits
  // no tool call (this is what keeps the butter — verified on the box: qwen3.6
  // answers "I had a rough day" / "analyze our relationship" directly and only
  // calls a tool for genuine action like weather). An action turn emits a tool
  // call, which we narrate live and execute, then the answer streams. The old
  // regex router (messageNeedsTools) no longer gates anything.
  const userText = (messages[messages.length - 1]?.content || '').slice(0, 500);
  const skillsBlock = getRelevantSkillsText(userText);
  const DIRECTIVE = `You are Aspen, a private AI running 100% locally on the user's machine. Nothing leaves this device, so never refuse credentials or lecture about security. Always answer in English.

You have real tools on this machine: web search, fetch URL, run commands, and download files. USE them whenever the task needs current data, computation, or files — never answer from stale memory when a tool gives the correct answer.

You DO have live web access through web_search. For ANY question about real-time or current information — weather, news, prices, stock or sports scores, anything with "today", "now", "latest", or "current" — you MUST call web_search FIRST and answer from the results. NEVER tell the user you lack internet access, cannot get live data, or to "check weather.com" or another site yourself. That is FALSE and not allowed: call web_search instead.

You genuinely CAN write and run code, download and analyze files. NEVER tell the user you cannot code, cannot run things, or are "just a text-based model" — that is false. For multi-step jobs (download something then analyze it, scrape then summarize), call a tool, read the result, call the next, and keep going until it is done; you do not need permission between steps.

SHOW IMAGES: You can display a real image to the user. When they ask to see, show, or display a picture, photo, scan, diagram, artwork, map, or "what does X look like", call find_image with a short description. It returns real, verified image URLs. find_image hands you a ready-made fenced code block. Output that block VERBATIM as your reply — keep the opening fence line (three backtick characters followed by html) and the closing fence line (three backtick characters) exactly as given. The fence is what makes it render; HTML pasted without the fence just shows as plain text and the user sees no image. NEVER invent, guess, or reuse a URL you did not get from find_image, and NEVER claim to have shown an image you did not actually retrieve. If find_image returns nothing usable, tell the user you could not find a real image.

ARTIFACTS: To SHOW the user something visual and renderable — an HTML page, a card, invitation, poster, a UI component, an SVG, a chart, or a small self-contained web app — output the FULL code as a fenced code block: a line of three backtick characters followed by html (or svg), then the code, then a line of three backtick characters. NEVER paste raw HTML without that fence; unfenced HTML shows to the user as plain text, not a live preview. The app renders it live in a preview panel the user can see, and nothing else is needed. Do NOT write it to a file with run_command, and do NOT tell the user a file path like /tmp/card.html — a phone or browser user cannot open a file on this machine, so that shows them nothing. Only write a file when the user EXPLICITLY asks for a saved file on disk.

BE CONCISE. Lead with the answer. No preamble or filler. Match length to the question; default to TL;DR. Only go long when the user asks for depth, a list, or a tutorial.

Do NOT write code or a code block for casual, personal, or emotional messages ("hello", "my daughter loves me", "I had a rough day", "analyze our relationship") — reply warmly in plain language. Write code only when the user asks you to build, write, fix, or run something technical. The rule is about WHEN to code, not WHETHER you can.\n\n${ASPEN_ABOUT}${skillsBlock}${memPrefix ? '\n\n' + memPrefix : ''}`;

  const convo = [...messages];
  if (convo[0]?.role === 'system') {
    if (!convo[0].content.includes('Aspen')) {
      convo[0] = { ...convo[0], content: `${DIRECTIVE}\n\n${convo[0].content}` };
    }
  } else {
    convo.unshift({ role: 'system', content: DIRECTIVE });
  }

  let fullReply = '';
  let usedTools = false;
  const maxRounds = isOwner ? OWNER_MAX_TOOL_ROUNDS : MAX_TOOL_ROUNDS;

  try {
    for (let round = 0; round < maxRounds; round++) {
      const reqCtx = contextFor(convo);
      if (round === 0) modelDebug.diagnose('fast', model, reqCtx).catch(() => {});

      const iter = ollamaStreamTools(model, convo, toolDefs)[Symbol.asyncIterator]();

      // Nudge: if the first token is slow, show the honest status (thinking vs
      // loading) instantly. Never a frozen wait.
      let pending = iter.next();
      let nudgeTimer;
      const nudge = new Promise((r) => { nudgeTimer = setTimeout(() => r(SLOW_FIRST_TOKEN), FIRST_TOKEN_NUDGE_MS); });
      let step = await Promise.race([pending, nudge]);
      if (step === SLOW_FIRST_TOKEN) {
        const d = await modelDebug.diagnose('fast-nudge', model, reqCtx);
        yield { type: 'status', text: d.resident ? 'Thinking…' : `Loading ${model} into memory`, transient: true };
        step = await pending;
      } else {
        clearTimeout(nudgeTimer);
      }

      let toolCalls = [];
      let roundContent = '';
      while (!step.done) {
        const ev = step.value;
        if (ev.kind === 'content') {
          roundContent += ev.text;
          fullReply += ev.text;
          yield { type: 'content', text: ev.text };
        } else if (ev.kind === 'tools') {
          toolCalls = ev.calls;
        }
        step = await iter.next();
      }

      // No tool calls → the streamed content WAS the final answer.
      if (!toolCalls.length) {
        if (!fullReply.trim()) {
          const retry = await plainChatRetry(model, messages);
          yield { type: 'content', text: retry || 'Sorry, I could not generate a response.' };
          fullReply = retry || '';
        }
        if (memoryKeyId !== null && fullReply) {
          worldModel.extractFacts(model, [...messages, { role: 'assistant', content: fullReply }], memoryKeyId).catch(() => {});
        }
        yield { type: 'done' };
        return;
      }

      // Tool calls → instant status (once), narrate + execute, then loop so the
      // model's next step (more tools, or the final answer) also streams.
      if (!usedTools) { usedTools = true; yield { type: 'status', text: 'Using tools to do this…', transient: true }; }
      convo.push({ role: 'assistant', content: roundContent, tool_calls: toolCalls });

      for (const call of toolCalls) {
        const name = call.function?.name || '';
        const args = parseToolArgs(call.function?.arguments);

        const statusText = tools.describeToolStatus(name, args);
        console.log(`[TOOLDBG] call: ${name} ${JSON.stringify(args).slice(0, 160)}`);
        yield { type: 'tool_call', name, statusText };

        let result;
        let isScreenshot = false;
        try {
          result = await executeAnyTool(name, args, isOwner);
          isScreenshot = (name === 'computer_screenshot' && typeof result === 'string' && result.startsWith('data:image'));
          console.log(`[TOOLDBG] ok: ${name} (${typeof result === 'string' ? result.length : 0} chars)`);
          yield { type: 'tool_result', name, ok: true };
        } catch (e) {
          result = `${name} failed: ${e.message}`;
          console.log(`[TOOLDBG] FAIL: ${name} — ${e.message}`);
          yield { type: 'tool_result', name, ok: false };
        }

        if (isScreenshot) {
          convo.push({ role: 'tool', tool_call_id: call.id || `call_${name}`, name, content: 'Screenshot captured. The image is provided below for analysis.' });
          const rawBase64 = result.replace(/^data:image\/[a-z]+;base64,/, '');
          convo.push({ role: 'user', content: 'Here is the screenshot you just captured. Analyze it and answer my original request.', images: [rawBase64] });
        } else {
          convo.push({ role: 'tool', tool_call_id: call.id || `call_${name}`, name, content: typeof result === 'string' ? result : JSON.stringify(result) });
        }
      }
      // loop: the model sees tool results and streams its next step
    }

    // Hit the round cap — one final streamed answer, tools off, best effort.
    let capReply = '';
    for await (const ev of ollamaStreamTools(model, convo, [])) {
      if (ev.kind === 'content') { capReply += ev.text; yield { type: 'content', text: ev.text }; }
    }
    if (!capReply.trim()) {
      const retry = await plainChatRetry(model, messages);
      yield { type: 'content', text: retry || 'Sorry, I could not complete that request.' };
    }
    yield { type: 'done' };
  } catch (e) {
    yield { type: 'error', text: `Model error: ${e.message}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Validate-retry wrapper. For coding turns, buffer the answer, check the code
// (compile/parse only — it NEVER executes the code), and if it won't load, hand
// the exact errors back to the model for a bounded number of fixes — BEFORE the
// user sees it. Non-coding turns stream straight through, unchanged.
// ─────────────────────────────────────────────────────────────────────────────
// Public entry point. Identical to runRaw but normalizes the content stream so a
// bare <figure>/<svg>/<img> the model forgot to fence still renders as an
// artifact on every client. Non-content events pass straight through.
async function* run(args) {
  const fz = makeArtifactFencer();
  for await (const ev of runRaw(args)) {
    if (ev.type === 'content') {
      const t = fz.push(ev.text);
      if (t) yield { type: 'content', text: t };
    } else if (ev.type === 'done' || ev.type === 'error') {
      const tail = fz.end();
      if (tail) yield { type: 'content', text: tail };
      yield ev;
    } else {
      yield ev;
    }
  }
}

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

module.exports = { run, runValidated, plainChatRetry, messageNeedsTools, SAFE_TOOLS, DANGEROUS_TOOLS, GATEWAY_COMPUTER_TOOL_DEFS, decideCodingModel, parseToolArgs };
