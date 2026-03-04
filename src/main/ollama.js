const { exec, spawn } = require('child_process');
const { app, shell } = require('electron');
const path = require('path');
const http = require('http');
const os = require('os');

const OLLAMA_HOST = 'http://127.0.0.1:11434';
let chatController = null;

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
  const installed = await isInstalled();
  return { installed, running, host: OLLAMA_HOST };
}

// ═══════════════════════════════════════════════════
// Installation Detection
// ═══════════════════════════════════════════════════

function isInstalled() {
  return new Promise((resolve) => {
    const cmd = process.platform === 'win32' ? 'where ollama' : 'which ollama';
    exec(cmd, (err) => resolve(!err));
  });
}

function getOllamaPath() {
  if (process.platform === 'darwin') {
    // macOS: Ollama installs to /usr/local/bin/ollama or the app bundle
    const paths = [
      '/usr/local/bin/ollama',
      '/opt/homebrew/bin/ollama',
      path.join(os.homedir(), '.ollama', 'ollama'),
    ];
    return paths[0]; // Default
  }
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe');
  }
  return 'ollama';
}

// ═══════════════════════════════════════════════════
// Install Ollama
// ═══════════════════════════════════════════════════

async function install() {
  // Open Ollama download page — simplest cross-platform approach
  // In production, we'd download + run the installer silently
  const url = process.platform === 'darwin'
    ? 'https://ollama.com/download/mac'
    : 'https://ollama.com/download/windows';
  shell.openExternal(url);
  return { success: true, message: 'Opened Ollama download page' };
}

// ═══════════════════════════════════════════════════
// Start / Ensure Running
// ═══════════════════════════════════════════════════

async function ensureRunning() {
  if (await isRunning()) {
    return { success: true, alreadyRunning: true };
  }

  const installed = await isInstalled();
  if (!installed) {
    return { success: false, error: 'not_installed' };
  }

  // Try to start Ollama serve in background
  return new Promise((resolve) => {
    const child = spawn('ollama', ['serve'], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11434' },
    });
    child.unref();

    // Poll until running (up to 15 seconds)
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      if (await isRunning()) {
        clearInterval(poll);
        resolve({ success: true, alreadyRunning: false });
      } else if (attempts > 30) {
        clearInterval(poll);
        resolve({ success: false, error: 'timeout' });
      }
    }, 500);
  });
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
};
