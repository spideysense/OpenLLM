const { spawn, execSync } = require('child_process');
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const system = require('./system');
const http = require('http');
const os = require('os');
const { runFetchUrl } = require('./tools');

const OLLAMA_HOST = 'http://127.0.0.1:11434';
const MONET_DIR = path.join(os.homedir(), '.aspen');
const BIN_DIR = path.join(MONET_DIR, 'bin');
let chatController = null;
let ollamaProcess = null;

// ═══════════════════════════════════════════════════
// Find Ollama Binary — bundled → system → downloaded
// ═══════════════════════════════════════════════════

function getBundledPath() {
  const ext = process.platform === 'win32' ? '.exe' : '';
  const name = `ollama${ext}`;
  const roots = [];
  if (app.isPackaged) roots.push(path.join(process.resourcesPath, 'vendor', 'ollama'));
  roots.push(path.join(__dirname, '..', '..', 'vendor', 'ollama'));
  for (const root of roots) {
    for (const p of [path.join(root, name), path.join(root, 'bin', name)]) {
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function getSystemPath() {
  const candidates = process.platform === 'darwin'
    ? ['/usr/local/bin/ollama', '/opt/homebrew/bin/ollama']
    : process.platform === 'win32'
      ? [path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe')]
      : ['/usr/local/bin/ollama', '/usr/bin/ollama'];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function getDownloadedPath() {
  const ext = process.platform === 'win32' ? '.exe' : '';
  const candidates = [
    path.join(BIN_DIR, `ollama${ext}`),
    path.join(BIN_DIR, 'bin', `ollama${ext}`),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p) && fs.statSync(p).size > 1_000_000) return p;
  }
  return null;
}

function getOllamaPath() {
  return getBundledPath() || getSystemPath() || getDownloadedPath() || null;
}

// ═══════════════════════════════════════════════════
// Silent Download — no browser, no terminal, no user action
// ═══════════════════════════════════════════════════

// GitHub releases URLs — try multiple formats since Ollama changes these
const DOWNLOAD_URLS = {
  darwin: [
    'https://github.com/ollama/ollama/releases/latest/download/ollama-darwin.tgz',
    'https://github.com/ollama/ollama/releases/latest/download/ollama-darwin',
    'https://github.com/ollama/ollama/releases/latest/download/ollama-darwin-arm64.tgz',
    'https://github.com/ollama/ollama/releases/latest/download/ollama-darwin-arm64',
  ],
  // Base arm64 ships CPU + cuda_v12 + cuda_v13 runtimes. The GB10 (Blackwell, sm_121,
  // CUDA-13 driver) is served by the bundled cuda_v13 — verified on-device (121 GiB iGPU).
  // The jetpack overlays are libs-only (no binary) and weren't selected, so base is all we need.
  linux: process.arch === 'arm64' ? [
    'https://github.com/ollama/ollama/releases/latest/download/ollama-linux-arm64.tar.zst',
  ] : [
    'https://github.com/ollama/ollama/releases/latest/download/ollama-linux-amd64.tar.zst',
  ],
  win32: [
    'https://github.com/ollama/ollama/releases/latest/download/ollama-windows-amd64.zip',
    'https://github.com/ollama/ollama/releases/latest/download/ollama-windows-amd64.exe',
  ],
};

async function downloadOllama(notify, { force = false } = {}) {
  const ext = process.platform === 'win32' ? '.exe' : '';
  const destPath = path.join(BIN_DIR, `ollama${ext}`);

  // Already have it — unless we're force-updating after a pull failure
  if (!force && fs.existsSync(destPath) && fs.statSync(destPath).size > 1_000_000) {
    return destPath;
  }

  // Delete old binary so we get a fresh one
  try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch {}

  fs.mkdirSync(BIN_DIR, { recursive: true });

  const urls = DOWNLOAD_URLS[process.platform];
  if (!urls || urls.length === 0) throw new Error('Unsupported platform: ' + process.platform);

  let lastErr = null;
  for (const url of urls) {
    try {
      const isTgz = url.endsWith('.tgz');
      const isZst = url.endsWith('.tar.zst');
      const isZip = url.endsWith('.zip');

      if (isTgz || isZst || isZip) {
        const archiveExt = isTgz ? '.tgz' : isZst ? '.tar.zst' : '.zip';
        const archivePath = path.join(BIN_DIR, `ollama-download${archiveExt}`);

        notify('Downloading AI engine...');
        await downloadFileWithProgress(url, archivePath, notify);

        notify('Setting up AI engine...');

        if (isTgz) {
          execSync(`tar -xzf "${archivePath}" -C "${BIN_DIR}"`, { stdio: 'pipe' });
        } else if (isZst) {
          execSync(`tar --zstd -xf "${archivePath}" -C "${BIN_DIR}"`, { stdio: 'pipe' });
        } else {
          execSync(
            `powershell -command "Expand-Archive -Path '${archivePath}' -DestinationPath '${BIN_DIR}' -Force"`,
            { stdio: 'pipe' }
          );
        }

        try { fs.unlinkSync(archivePath); } catch {}

        // Run the binary from where it extracted. Modern Ollama ships bin/ollama with a
        // sibling lib/ollama (CPU + CUDA runtimes) it loads via $ORIGIN/../lib rpath, so we
        // must NOT relocate the binary out of that tree.
        const candidates = [path.join(BIN_DIR, 'ollama'), path.join(BIN_DIR, 'bin', 'ollama')];
        for (const c of candidates) {
          if (fs.existsSync(c) && fs.statSync(c).size > 1_000_000) {
            if (process.platform !== 'win32') { try { fs.chmodSync(c, 0o755); } catch {} }
            if (process.platform === 'darwin') { try { execSync(`xattr -cr "${c}"`, { stdio: 'pipe' }); } catch {} }
            return c;
          }
        }
      } else {
        // Direct binary download
        notify('Downloading AI engine...');
        await downloadFileWithProgress(url, destPath, notify);

        if (fs.existsSync(destPath) && fs.statSync(destPath).size > 1_000_000) {
          if (process.platform !== 'win32') { try { fs.chmodSync(destPath, 0o755); } catch {} }
          if (process.platform === 'darwin') { try { execSync(`xattr -cr "${destPath}"`, { stdio: 'pipe' }); } catch {} }
          return destPath;
        }
      }
    } catch (err) {
      lastErr = err;
      console.log(`[Ollama] Download failed for ${url}: ${err.message}, trying next...`);
      continue;
    }
  }

  throw lastErr || new Error('All download URLs failed');
}

function downloadFileWithProgress(url, dest, notify) {
  return new Promise((resolve, reject) => {
    const follow = (url, redirects = 0) => {
      if (redirects > 10) return reject(new Error('Too many redirects'));
      const mod = url.startsWith('https') ? https : http;
      mod.get(url, { headers: { 'User-Agent': 'Aspen/1.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return follow(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        }

        const total = parseInt(res.headers['content-length'], 10) || 0;
        let downloaded = 0;
        let lastNotify = 0;

        const file = fs.createWriteStream(dest);
        res.on('data', (chunk) => {
          downloaded += chunk.length;
          const now = Date.now();
          if (total && now - lastNotify > 1000) {
            const pct = Math.round((downloaded / total) * 100);
            const mb = (downloaded / 1e6).toFixed(0);
            const totalMb = (total / 1e6).toFixed(0);
            notify(`Downloading AI engine... ${pct}% (${mb}/${totalMb} MB)`);
            lastNotify = now;
          }
        });
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', (err) => {
          fs.unlink(dest, () => {});
          reject(err);
        });
      }).on('error', reject);
    };
    follow(url);
  });
}

// ═══════════════════════════════════════════════════
// Health & Status
// ═══════════════════════════════════════════════════

async function isRunning() {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/version`);
    return res.ok;
  } catch {
    return false;
  }
}

// Newest models (gemma4, qwen3, llama4) require a recent Ollama. If the running
// Ollama is older, pulling them fails with HTTP 412 "requires a newer version".
// We treat this as the bar for "current enough".
const MIN_OLLAMA_VERSION = '0.20.0';

function versionGte(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return true;
}

async function getRunningVersion() {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/version`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.version || null;
  } catch {
    return null;
  }
}

// Is the currently running Ollama new enough for the latest models?
async function isCurrentEnough() {
  const v = await getRunningVersion();
  if (!v) return false;
  return versionGte(v, MIN_OLLAMA_VERSION);
}

async function getStatus() {
  const running = await isRunning();
  const ollamaPath = getOllamaPath();
  return { installed: ollamaPath !== null, running, host: OLLAMA_HOST, ollamaPath };
}

function isInstalled() {
  return Promise.resolve(getOllamaPath() !== null);
}

// ═══════════════════════════════════════════════════
// Start — automatic, downloads if needed, NEVER opens browser
// ═══════════════════════════════════════════════════

async function ensureRunning(onProgress) {
  const notify = onProgress || (() => {});

  if (await isRunning()) {
    return { success: true, alreadyRunning: true };
  }

  let ollamaPath = getOllamaPath();

  // Download silently if not found
  if (!ollamaPath) {
    try {
      ollamaPath = await downloadOllama(notify);
    } catch (err) {
      console.error('[Ollama] Download failed:', err);
      return {
        success: false,
        error: 'download_failed',
        message: 'Could not download AI engine. Check your internet connection and restart Aspen.',
      };
    }
  }

  if (!ollamaPath) {
    return {
      success: false,
      error: 'not_found',
      message: 'Could not set up AI engine. Please restart Aspen.',
    };
  }

  // Make sure it's executable + clear macOS quarantine
  if (process.platform !== 'win32') {
    try { fs.chmodSync(ollamaPath, 0o755); } catch {}
  }
  if (process.platform === 'darwin') {
    try { require('child_process').execSync(`xattr -cr "${ollamaPath}"`, { stdio: 'pipe' }); } catch {}
  }

  notify('Starting AI engine...');

  return new Promise((resolve) => {
    try {
      ollamaProcess = spawn(ollamaPath, ['serve'], {
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          OLLAMA_HOST: '127.0.0.1:11434',
          OLLAMA_MODELS: path.join(MONET_DIR, 'models'),
        },
      });
      ollamaProcess.unref();

      ollamaProcess.on('error', (err) => {
        console.error('[Ollama] Failed to start:', err.message);
        resolve({
          success: false,
          error: 'start_failed',
          message: 'Could not start AI engine. Please restart Aspen.',
        });
      });

      // Poll until running (up to 20 seconds)
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        if (await isRunning()) {
          clearInterval(poll);
          notify('AI engine running!');
          resolve({ success: true, alreadyRunning: false });
        } else if (attempts > 40) {
          clearInterval(poll);
          resolve({
            success: false,
            error: 'timeout',
            message: 'AI engine took too long to start. Please restart Aspen.',
          });
        }
      }, 500);
    } catch (err) {
      resolve({ success: false, error: 'spawn_failed', message: 'Could not start AI engine.' });
    }
  });
}

async function install() {
  return { success: true };
}

// ═══════════════════════════════════════════════════
// Silent Ollama upgrade — for Luddite users who never touch a terminal.
// If the running Ollama is too old for the latest models, download the newest
// Ollama ourselves, stop the old server, and start the new one. Invisible.
// ═══════════════════════════════════════════════════
async function ensureCurrent(onProgress, { force = false } = {}) {
  const notify = onProgress || (() => {});
  // Already current? Nothing to do — unless a pull explicitly told us otherwise.
  if (!force && await isCurrentEnough()) return { success: true, upgraded: false };

  notify('Updating AI engine…');
  try {
    // Always pulls releases/latest (newest Ollama) into Aspen's own bin dir.
    const newPath = await downloadOllama(notify, { force });
    if (!newPath) return { success: false, error: 'download_failed' };

    // Stop the old server (ours if we spawned it; otherwise the system one).
    try { if (ollamaProcess) { ollamaProcess.kill('SIGTERM'); ollamaProcess = null; } } catch {}
    // Also stop any system ollama serving on the port so the new one can bind.
    if (process.platform !== 'win32') {
      try { execSync('pkill -f "ollama serve" || true', { stdio: 'pipe' }); } catch {}
    }
    // Give the port a moment to free up.
    await new Promise((r) => setTimeout(r, 1500));

    // Start the freshly downloaded Ollama.
    if (process.platform !== 'win32') { try { fs.chmodSync(newPath, 0o755); } catch {} }
    if (process.platform === 'darwin') { try { execSync(`xattr -cr "${newPath}"`, { stdio: 'pipe' }); } catch {} }

    ollamaProcess = spawn(newPath, ['serve'], {
      detached: true, stdio: 'ignore',
      env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11434', OLLAMA_MODELS: path.join(MONET_DIR, 'models') },
    });
    ollamaProcess.unref();

    // Poll until the new one is up (up to ~15s).
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await isCurrentEnough()) { notify('AI engine updated!'); return { success: true, upgraded: true }; }
    }
    // It started but version still reads old (shouldn't happen) — report honestly.
    return { success: (await isRunning()), upgraded: true, warning: 'version_unconfirmed' };
  } catch (err) {
    console.error('[Ollama] Upgrade failed:', err.message);
    return { success: false, error: 'upgrade_failed', message: err.message };
  }
}

// ═══════════════════════════════════════════════════
// Chat / Streaming
// ═══════════════════════════════════════════════════
// Aspen-level web search — local model decides if search is needed
// No hardcoded keywords. Works with any model (Qwen, Llama, DeepSeek, etc.)

// ═══════════════════════════════════════════════════
// Vision (multimodal) support
// ═══════════════════════════════════════════════════
// Known vision-capable model families on Ollama. Matched as a prefix on the
// model name (before any ':tag'). Kept conservative to avoid false positives.
const VISION_MODELS = ['llava', 'llava-llama3', 'llava-phi3', 'bakllava', 'moondream', 'llama3.2-vision', 'llama4', 'gemma3', 'qwen2-vl', 'qwen2.5-vl', 'minicpm-v', 'gemma4'];

// Known tool-capable model families (used as fallback if /api/show doesn't return capabilities)
const TOOL_MODELS = ['llama3', 'llama3.1', 'llama3.2', 'llama3.3', 'qwen2.5', 'qwen2', 'mistral', 'mixtral', 'gemma3', 'gemma4', 'phi4', 'phi3', 'command-r', 'deepseek', 'hermes', 'functionary', 'firefunction', 'xwin-moe', 'nous-hermes', 'smollm2'];

// Fetch model capabilities from Ollama /api/show.
// Returns { tools: bool, vision: bool }
async function getModelCapabilities(modelName) {
  if (!modelName) return { tools: false, vision: false };
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelName }),
    });
    if (res.ok) {
      const data = await res.json();
      const caps = Array.isArray(data.capabilities) ? data.capabilities : [];
      if (caps.length > 0) {
        return {
          tools: caps.includes('tools'),
          vision: caps.includes('vision'),
        };
      }
    }
  } catch { /* fall through to heuristic */ }
  // Fallback: name-based heuristic
  const base = String(modelName).split(':')[0].toLowerCase();
  return {
    tools: TOOL_MODELS.some((t) => base === t || base.startsWith(t)),
    vision: VISION_MODELS.some((v) => base === v || base.startsWith(v)),
  };
}
// The model we offer to pull on one tap — small, well-supported, Apache-2.0.
const RECOMMENDED_VISION_MODEL = 'llava';

function isVisionModel(model) {
  if (!model) return false;
  const base = String(model).split(':')[0].toLowerCase();
  return VISION_MODELS.some((v) => base === v || base.startsWith(v));
}

async function listModels() {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models || []).map((m) => m.name);
  } catch { return []; }
}

// Is any vision-capable model already installed?
async function hasVisionModel() {
  const models = await listModels();
  return models.some((m) => isVisionModel(m));
}

// Pull a model with streaming progress. onProgress({status, percent}).
let pullController = null;
async function pullModel(model, onProgress) {
  const notify = onProgress || (() => {});
  pullController = new AbortController();
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: true }),
      signal: pullController.signal,
    });
    if (!res.ok) return { success: false, error: `Pull failed: HTTP ${res.status}` };
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = decoder.decode(value, { stream: true }).split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const j = JSON.parse(line);
          let percent = null;
          if (j.total && j.completed) percent = Math.round((j.completed / j.total) * 100);
          notify({ status: j.status || 'downloading', percent });
          if (j.error) return { success: false, error: j.error };
        } catch {}
      }
    }
    return { success: true };
  } catch (err) {
    if (err.name === 'AbortError') return { success: false, aborted: true };
    return { success: false, error: err.message };
  } finally {
    pullController = null;
  }
}

function abortPull() {
  if (pullController) { pullController.abort(); return { success: true }; }
  return { success: false, error: 'No active pull' };
}

async function chat(model, messages, onChunk) {
  chatController = new AbortController();

  try {
    // Aspen-level search: ask the local model if this needs real-time data
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const userText = lastUser?.content || '';
    let enrichedMessages = messages;
    if (userText.length > 3) {
      // If the user pasted a URL, fetch it directly and inject the content. This
      // doesn't rely on the small model choosing to call a tool (which it often
      // won't). For YouTube links this returns the video's metadata + description.
      const urlMatch = userText.match(/https?:\/\/[^\s)]+/);
      if (urlMatch) {
        onChunk({ content: '🌐 Reading the link…', done: false });
        try {
          const pageText = await runFetchUrl({ url: urlMatch[0] });
          if (pageText && !/^Could not fetch/.test(pageText)) {
            const urlBlock = `\n\n--- Content fetched from ${urlMatch[0]} ---\n${pageText}\n--- End of fetched content ---\n\nUse the fetched content above to answer the user's question about this link. If it's a YouTube video, you have its title, channel, and description but cannot see the actual footage — be honest about that limit.`;
            const hasSys = enrichedMessages[0]?.role === 'system';
            if (hasSys) enrichedMessages = [{ ...enrichedMessages[0], content: enrichedMessages[0].content + urlBlock }, ...enrichedMessages.slice(1)];
            else enrichedMessages = [{ role: 'system', content: `You are a helpful assistant.${urlBlock}` }, ...enrichedMessages];
          }
        } catch {}
        onChunk({ content: '', done: false });
      }
      // Note: web_search / calculate / get_datetime are handled by the native
      // tool-calling agent loop (agent.js) when tools are enabled. This plain
      // streaming path runs only when tools are OFF, so we respect that and don't
      // invoke tools here — we just keep the deterministic URL read above.
    }

    const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: enrichedMessages, stream: true, keep_alive: -1, options: { num_predict: -1, num_ctx: system.getRecommendedContext() } }),
      signal: chatController.signal,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Ollama error: ${err}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullResponse = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value, { stream: true });
      const lines = text.split('\n').filter(Boolean);

      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          if (json.message?.content) {
            fullResponse += json.message.content;
            onChunk({ content: json.message.content, done: json.done || false });
          }
          if (json.done) {
            onChunk({ content: '', done: true, total_duration: json.total_duration, eval_count: json.eval_count });
          }
        } catch (e) {}
      }
    }

    return { success: true, response: fullResponse };
  } catch (err) {
    if (err.name === 'AbortError') return { success: true, aborted: true };
    return { success: false, error: err.message };
  } finally {
    chatController = null;
  }
}

function abortChat() {
  if (chatController) { chatController.abort(); return { success: true }; }
  return { success: false, error: 'No active chat' };
}

// Warm a model so the first real message doesn't pay the cold-load penalty.
// keep_alive:-1 keeps it resident; num_predict:1 makes the ping nearly free.
// Fire-and-forget — failure is harmless (the next real request still loads it).
function warmModel(model) {
  if (!model) return;
  try {
    fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], stream: false, keep_alive: -1, options: { num_predict: 1, num_ctx: system.getRecommendedContext() } }),
    }).then((r) => r.text()).then(() => console.log(`[Aspen] Warmed model: ${model}`)).catch(() => {});
  } catch {}
}

// Awaitable warm — resolves only once the model is actually loaded into memory
// (Ollama loads before it generates). Used by onboarding so the first real
// message isn't a cold wait, and the loading time is shown instead of hidden.
async function warmModelAndWait(model, timeoutMs = 300000) {
  if (!model) return { success: false };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], stream: false, keep_alive: -1, options: { num_predict: 1, num_ctx: system.getRecommendedContext() } }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    await r.text();
    console.log(`[Aspen] Warm-loaded model: ${model}`);
    return { success: r.ok };
  } catch (e) {
    return { success: false, error: String((e && e.message) || e) };
  }
}

module.exports = {
  isRunning, isInstalled, getStatus, install, ensureRunning,
  ensureCurrent, isCurrentEnough, getRunningVersion,
  chat, abortChat, getOllamaPath, getBundledPath, getDownloadedPath,
  isVisionModel, hasVisionModel, listModels, pullModel, abortPull, getModelCapabilities,
  warmModel,
  warmModelAndWait,
  RECOMMENDED_VISION_MODEL,
};
