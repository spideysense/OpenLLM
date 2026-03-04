const { spawn } = require('child_process');
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');

const OLLAMA_HOST = 'http://127.0.0.1:11434';
let chatController = null;
let ollamaProcess = null;

// ═══════════════════════════════════════════════════
// Find Ollama Binary — bundled first, then system
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
  // Check common locations
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

function getOllamaPath() {
  return getBundledPath() || getSystemPath() || 'ollama';
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
  return { installed: true, running, host: OLLAMA_HOST, bundled, ollamaPath };
}

function isInstalled() {
  return Promise.resolve(true); // Always true — we bundle it
}

// ═══════════════════════════════════════════════════
// Start Ollama — automatic, no user action needed
// ═══════════════════════════════════════════════════

async function ensureRunning(onProgress) {
  const notify = onProgress || (() => {});

  if (await isRunning()) {
    return { success: true, alreadyRunning: true };
  }

  const ollamaPath = getOllamaPath();
  notify('Starting AI engine...');

  // Make sure bundled binary is executable
  if (getBundledPath() && process.platform !== 'win32') {
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
          // Store models in app-specific location
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

// No-op — Ollama is bundled, nothing to install
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
};
