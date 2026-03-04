const { spawn } = require('child_process');
const { app, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const os = require('os');

const OLLAMA_HOST = 'http://127.0.0.1:11434';
let chatController = null;
let ollamaProcess = null;

// ═══════════════════════════════════════════════════
// Find Ollama Binary — bundled → system → downloaded
// ═══════════════════════════════════════════════════

function getBundledPath() {
  const ext = process.platform === 'win32' ? '.exe' : '';
  const name = `ollama${ext}`;

  // In packaged app: resources/vendor/ollama/
  if (app.isPackaged) {
    const resourcePath = path.join(process.resourcesPath, 'vendor', 'ollama', name);
    if (fs.existsSync(resourcePath)) return resourcePath;
  }

  // In dev: vendor/ollama/
  const devPath = path.join(__dirname, '..', '..', 'vendor', 'ollama', name);
  if (fs.existsSync(devPath)) return devPath;

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
  const p = path.join(os.homedir(), '.llmbear', 'bin', `ollama${ext}`);
  if (fs.existsSync(p)) return p;
  return null;
}

function getOllamaPath() {
  return getBundledPath() || getSystemPath() || getDownloadedPath() || null;
}

// ═══════════════════════════════════════════════════
// Download Ollama at runtime if not found anywhere
// ═══════════════════════════════════════════════════

async function downloadOllama(notify) {
  const ext = process.platform === 'win32' ? '.exe' : '';
  const destDir = path.join(os.homedir(), '.llmbear', 'bin');
  const destPath = path.join(destDir, `ollama${ext}`);

  if (fs.existsSync(destPath)) {
    const stats = fs.statSync(destPath);
    if (stats.size > 1_000_000) return destPath; // Already downloaded
  }

  fs.mkdirSync(destDir, { recursive: true });
  notify('Downloading AI engine (~100MB)...');

  const urls = {
    darwin: 'https://ollama.com/download/ollama-darwin',
    win32: 'https://ollama.com/download/ollama-windows-amd64.exe',
    linux: 'https://ollama.com/download/ollama-linux-amd64',
  };

  const url = urls[process.platform];
  if (!url) throw new Error('Unsupported platform');

  try {
    await downloadFile(url, destPath);
    if (process.platform !== 'win32') {
      fs.chmodSync(destPath, 0o755);
    }
    return destPath;
  } catch (err) {
    console.error('[Ollama] Download failed:', err.message);
    // Try the install.sh approach on macOS
    if (process.platform === 'darwin') {
      notify('Trying alternative install...');
      return new Promise((resolve, reject) => {
        const { exec } = require('child_process');
        exec('curl -fsSL https://ollama.com/install.sh | sh', { timeout: 180000 }, (err) => {
          if (err) {
            shell.openExternal('https://ollama.com/download');
            reject(new Error('Please install from ollama.com, then reopen LLM Bear'));
          } else {
            resolve(getSystemPath() || 'ollama');
          }
        });
      });
    }
    throw err;
  }
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const follow = (url, redirects = 0) => {
      if (redirects > 10) return reject(new Error('Too many redirects'));
      const mod = url.startsWith('https') ? https : http;
      mod.get(url, { headers: { 'User-Agent': 'LLMBear/1.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return follow(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', reject);
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
  const bundled = getBundledPath() !== null;
  return { installed: ollamaPath !== null, running, host: OLLAMA_HOST, bundled, ollamaPath };
}

function isInstalled() {
  return Promise.resolve(getOllamaPath() !== null);
}

// ═══════════════════════════════════════════════════
// Start Ollama — automatic, downloads if needed
// ═══════════════════════════════════════════════════

async function ensureRunning(onProgress) {
  const notify = onProgress || (() => {});

  if (await isRunning()) {
    return { success: true, alreadyRunning: true };
  }

  let ollamaPath = getOllamaPath();

  // Download if not found anywhere
  if (!ollamaPath) {
    notify('Setting up AI engine...');
    try {
      ollamaPath = await downloadOllama(notify);
    } catch (err) {
      return { success: false, error: 'download_failed', message: err.message || 'Could not download AI engine. Check your internet connection and try again.' };
    }
  }

  if (!ollamaPath) {
    return { success: false, error: 'not_found', message: 'Could not find or download AI engine. Please visit ollama.com to install manually.' };
  }

  notify('Starting AI engine...');

  // Make sure binary is executable
  if (process.platform !== 'win32') {
    try { fs.chmodSync(ollamaPath, 0o755); } catch {}
  }

  return new Promise((resolve) => {
    try {
      ollamaProcess = spawn(ollamaPath, ['serve'], {
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          OLLAMA_HOST: '127.0.0.1:11434',
          OLLAMA_MODELS: path.join(os.homedir(), '.llmbear', 'models'),
        },
      });
      ollamaProcess.unref();

      ollamaProcess.on('error', (err) => {
        console.error('[Ollama] Failed to start:', err.message);
        resolve({ success: false, error: 'start_failed', message: 'Could not start AI engine. Please restart LLM Bear.' });
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
          resolve({ success: false, error: 'timeout', message: 'AI engine took too long to start. Please restart LLM Bear.' });
        }
      }, 500);
    } catch (err) {
      console.error('[Ollama] Spawn error:', err.message);
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

async function chat(model, messages, onChunk) {
  chatController = new AbortController();

  try {
    const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true }),
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
            onChunk({
              content: json.message.content,
              done: json.done || false,
            });
          }
          if (json.done) {
            onChunk({
              content: '',
              done: true,
              total_duration: json.total_duration,
              eval_count: json.eval_count,
            });
          }
        } catch (e) {
          // Skip malformed lines
        }
      }
    }

    return { success: true, response: fullResponse };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { success: true, aborted: true };
    }
    return { success: false, error: err.message };
  } finally {
    chatController = null;
  }
}

function abortChat() {
  if (chatController) {
    chatController.abort();
    return { success: true };
  }
  return { success: false, error: 'No active chat' };
}

module.exports = {
  isRunning,
  isInstalled,
  getStatus,
  install,
  ensureRunning,
  chat,
  abortChat,
  getOllamaPath,
  getBundledPath,
  getDownloadedPath,
};
