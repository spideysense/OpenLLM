const { exec, spawn, execSync } = require('child_process');
const { app, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
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

async function install(onProgress) {
  const notify = onProgress || (() => {});

  if (process.platform === 'darwin') {
    // macOS: download Ollama CLI via install script
    notify('Downloading Ollama...');
    return new Promise((resolve) => {
      const child = exec(
        'curl -fsSL https://ollama.com/install.sh | sh',
        { timeout: 120000 },
        (err) => {
          if (err) {
            // Fallback: open download page
            notify('Auto-install failed. Opening download page...');
            shell.openExternal('https://ollama.com/download/mac');
            resolve({ success: false, error: 'auto_install_failed', message: 'Please install Ollama from the download page, then click Try Again.' });
          } else {
            notify('Ollama installed!');
            resolve({ success: true });
          }
        }
      );
    });
  } else if (process.platform === 'win32') {
    // Windows: download and run the installer
    notify('Downloading Ollama installer...');
    const installerPath = path.join(os.tmpdir(), 'OllamaSetup.exe');
    try {
      await downloadToFile('https://ollama.com/download/OllamaSetup.exe', installerPath);
      notify('Running installer...');
      exec(`"${installerPath}"`, (err) => {
        if (err) {
          shell.openExternal('https://ollama.com/download/windows');
        }
      });
      return { success: true, message: 'Installer launched. Follow the prompts, then click Try Again.' };
    } catch (e) {
      shell.openExternal('https://ollama.com/download/windows');
      return { success: false, error: 'download_failed' };
    }
  } else {
    shell.openExternal('https://ollama.com/download');
    return { success: false, error: 'unsupported_platform' };
  }
}

function downloadToFile(url, dest) {
  return new Promise((resolve, reject) => {
    const follow = (url, redirects = 0) => {
      if (redirects > 5) return reject(new Error('Too many redirects'));
      https.get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return follow(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
      }).on('error', reject);
    };
    follow(url);
  });
}

// ═══════════════════════════════════════════════════
// Start / Ensure Running
// ═══════════════════════════════════════════════════

async function ensureRunning(onProgress) {
  const notify = onProgress || (() => {});

  if (await isRunning()) {
    return { success: true, alreadyRunning: true };
  }

  let installed = await isInstalled();

  // Auto-install if needed
  if (!installed) {
    notify('Installing Ollama...');
    const installResult = await install(notify);
    if (!installResult.success) {
      return { success: false, error: 'install_failed', message: installResult.message || 'Could not install Ollama. Please install manually from ollama.com' };
    }
    // Re-check installation
    installed = await isInstalled();
    if (!installed) {
      return { success: false, error: 'install_failed', message: 'Ollama installed but not found. Please restart LLM Bear.' };
    }
  }

  // Try to start Ollama serve in background
  notify('Starting Ollama...');
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
        resolve({ success: false, error: 'timeout', message: 'Ollama installed but failed to start. Try restarting LLM Bear.' });
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
