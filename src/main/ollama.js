const { spawn, execSync } = require('child_process');
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const os = require('os');

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
  if (app.isPackaged) {
    const p = path.join(process.resourcesPath, 'vendor', 'ollama', name);
    if (fs.existsSync(p)) return p;
  }
  const dev = path.join(__dirname, '..', '..', 'vendor', 'ollama', name);
  if (fs.existsSync(dev)) return dev;
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
  const p = path.join(BIN_DIR, `ollama${ext}`);
  if (fs.existsSync(p) && fs.statSync(p).size > 1_000_000) return p;
  return null;
}

function getOllamaPath() {
  return getBundledPath() || getSystemPath() || getDownloadedPath() || null;
}

// ═══════════════════════════════════════════════════
// Silent Download — no browser, no terminal, no user action
// ═══════════════════════════════════════════════════

// GitHub releases URLs for the actual binaries
const DOWNLOAD_URLS = {
  darwin: 'https://github.com/ollama/ollama/releases/latest/download/ollama-darwin.tgz',
  linux: 'https://github.com/ollama/ollama/releases/latest/download/ollama-linux-amd64.tgz',
  win32: 'https://github.com/ollama/ollama/releases/latest/download/ollama-windows-amd64.zip',
};

async function downloadOllama(notify) {
  const ext = process.platform === 'win32' ? '.exe' : '';
  const destPath = path.join(BIN_DIR, `ollama${ext}`);

  // Already have it
  if (fs.existsSync(destPath) && fs.statSync(destPath).size > 1_000_000) {
    return destPath;
  }

  fs.mkdirSync(BIN_DIR, { recursive: true });

  const url = DOWNLOAD_URLS[process.platform];
  if (!url) throw new Error('Unsupported platform: ' + process.platform);

  const isTgz = url.endsWith('.tgz');
  const isZip = url.endsWith('.zip');

  if (isTgz || isZip) {
    // Download archive, extract, find binary
    const archiveExt = isTgz ? '.tgz' : '.zip';
    const archivePath = path.join(BIN_DIR, `ollama-download${archiveExt}`);

    notify('Downloading AI engine...');
    await downloadFileWithProgress(url, archivePath, notify);

    notify('Setting up AI engine...');

    if (isTgz) {
      // Extract tgz — tar is available on macOS and Linux
      execSync(`tar -xzf "${archivePath}" -C "${BIN_DIR}"`, { stdio: 'pipe' });
    } else {
      // Extract zip — PowerShell on Windows
      execSync(
        `powershell -command "Expand-Archive -Path '${archivePath}' -DestinationPath '${BIN_DIR}' -Force"`,
        { stdio: 'pipe' }
      );
    }

    // Clean up archive
    try { fs.unlinkSync(archivePath); } catch {}

    // Find the ollama binary in what we extracted
    // Could be at: bin/ollama, ollama, or nested
    const searchPaths = [
      destPath, // ~/.aspen/bin/ollama (ideal)
      path.join(BIN_DIR, 'bin', 'ollama'), // Some tgz nest in bin/
      path.join(BIN_DIR, `ollama-darwin`), // Raw name from archive
      path.join(BIN_DIR, `ollama-linux-amd64`),
    ];

    for (const candidate of searchPaths) {
      if (candidate !== destPath && fs.existsSync(candidate)) {
        fs.renameSync(candidate, destPath);
        break;
      }
    }

    if (!fs.existsSync(destPath)) {
      // Scan the directory for anything that looks like ollama
      const files = fs.readdirSync(BIN_DIR);
      console.log('[Ollama] Extracted files:', files);
      const match = files.find(f => f.startsWith('ollama') && !f.endsWith('.tgz') && !f.endsWith('.zip'));
      if (match) {
        fs.renameSync(path.join(BIN_DIR, match), destPath);
      }
    }
  } else {
    // Direct binary download
    notify('Downloading AI engine...');
    await downloadFileWithProgress(url, destPath, notify);
  }

  if (!fs.existsSync(destPath)) {
    throw new Error('Download completed but AI engine binary not found');
  }

  // Make executable
  if (process.platform !== 'win32') {
    fs.chmodSync(destPath, 0o755);
  }

  // macOS: clear quarantine attribute or Gatekeeper silently blocks execution
  if (process.platform === 'darwin') {
    try {
      require('child_process').execSync(`xattr -cr "${destPath}"`, { stdio: 'pipe' });
    } catch (e) {}
  }

  const sizeMB = (fs.statSync(destPath).size / 1e6).toFixed(0);
  notify(`AI engine ready (${sizeMB}MB)`);
  return destPath;
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
// Chat / Streaming
// ═══════════════════════════════════════════════════
// Aspen-level web search — local model decides if search is needed
// No hardcoded keywords. Works with any model (Qwen, Llama, DeepSeek, etc.)

const CLASSIFIER_PROMPT = `You are a search intent classifier. Your only job: does this question require real-time internet data to answer accurately?

Real-time data: current prices, today's news, live scores, recent events, current weather, who currently holds a position, anything that changes over time.

Answer with exactly one word: YES or NO.

Question: `;

async function askModelIfSearchNeeded(userMessage, model) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: CLASSIFIER_PROMPT + userMessage.slice(0, 400),
        stream: false,
        options: { temperature: 0, num_predict: 5 },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return false;
    const data = await res.json();
    return (data.response || '').trim().toUpperCase().startsWith('YES');
  } catch { clearTimeout(timeout); return false; }
}

async function fetchSearchResults(query) {
  try {
    const res = await fetch('https://runonaspen.com/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.results?.length) return null;
    return data.results.slice(0, 5)
      .map((r, i) => `[${i+1}] ${r.title}\n${r.snippet}${r.url ? `\nSource: ${r.url}` : ''}`)
      .join('\n\n');
  } catch { return null; }
}

async function chat(model, messages, onChunk) {
  chatController = new AbortController();

  try {
    // Aspen-level search: ask the local model if this needs real-time data
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const userText = lastUser?.content || '';
    let enrichedMessages = messages;
    if (userText.length > 3) {
      const needsSearch = await askModelIfSearchNeeded(userText, model);
      if (needsSearch) {
        onChunk({ content: '🔍 Searching…', done: false });
        const results = await fetchSearchResults(userText);
        if (results) {
          const searchBlock = `\n\n--- Live web search results ---\n${results}\n--- End results. Use these to answer accurately. ---`;
          const hasSystem = enrichedMessages[0]?.role === 'system';
          if (hasSystem) enrichedMessages = [{ ...enrichedMessages[0], content: enrichedMessages[0].content + searchBlock }, ...enrichedMessages.slice(1)];
          else enrichedMessages = [{ role: 'system', content: `You are a helpful assistant.${searchBlock}` }, ...enrichedMessages];
        }
        onChunk({ content: '', done: false });
      }
    }

    const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: enrichedMessages, stream: true }),
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

module.exports = {
  isRunning, isInstalled, getStatus, install, ensureRunning,
  chat, abortChat, getOllamaPath, getBundledPath, getDownloadedPath,
};
