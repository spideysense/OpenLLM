#!/usr/bin/env node

/**
 * Download Ollama binary for bundling inside the app.
 * Run this before electron-builder in the release workflow.
 *
 * Usage:
 *   node scripts/bundle-ollama.js           # current platform
 *   node scripts/bundle-ollama.js darwin     # macOS
 *   node scripts/bundle-ollama.js win32      # Windows
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const OLLAMA_VERSION = 'latest';
const VENDOR_DIR = path.join(__dirname, '..', 'vendor', 'ollama');

const DOWNLOADS = {
  darwin: {
    url: 'https://github.com/ollama/ollama/releases/latest/download/ollama-darwin',
    filename: 'ollama',
  },
  win32: {
    url: 'https://github.com/ollama/ollama/releases/latest/download/ollama-windows-amd64.exe',
    filename: 'ollama.exe',
  },
  linux: {
    url: 'https://github.com/ollama/ollama/releases/latest/download/ollama-linux-amd64',
    filename: 'ollama',
  },
};

async function main() {
  const platform = process.argv[2] || process.platform;
  const config = DOWNLOADS[platform];

  if (!config) {
    console.error(`Unsupported platform: ${platform}`);
    process.exit(1);
  }

  const destPath = path.join(VENDOR_DIR, config.filename);

  // Skip if already downloaded
  if (fs.existsSync(destPath)) {
    const stats = fs.statSync(destPath);
    if (stats.size > 1_000_000) { // > 1MB = probably valid
      console.log(`✓ Ollama binary already exists (${(stats.size / 1e6).toFixed(1)}MB)`);
      return;
    }
  }

  fs.mkdirSync(VENDOR_DIR, { recursive: true });

  console.log(`Downloading Ollama for ${platform}...`);
  console.log(`  From: ${config.url}`);
  console.log(`  To:   ${destPath}`);

  await downloadFile(config.url, destPath);

  // Make executable on Unix
  if (platform !== 'win32') {
    fs.chmodSync(destPath, 0o755);
  }

  const size = fs.statSync(destPath).size;
  console.log(`✓ Ollama downloaded (${(size / 1e6).toFixed(1)}MB)`);
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const follow = (url, redirects = 0) => {
      if (redirects > 10) return reject(new Error('Too many redirects'));

      const mod = url.startsWith('https') ? https : require('http');
      mod.get(url, { headers: { 'User-Agent': 'LLMBear/1.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return follow(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        }

        const total = parseInt(res.headers['content-length'], 10) || 0;
        let downloaded = 0;
        let lastLog = 0;

        const file = fs.createWriteStream(dest);
        res.on('data', (chunk) => {
          downloaded += chunk.length;
          const now = Date.now();
          if (total && now - lastLog > 2000) {
            const pct = ((downloaded / total) * 100).toFixed(0);
            process.stdout.write(`  ${pct}% (${(downloaded / 1e6).toFixed(1)}MB / ${(total / 1e6).toFixed(1)}MB)\r`);
            lastLog = now;
          }
        });
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          console.log('');
          resolve();
        });
        file.on('error', reject);
      }).on('error', reject);
    };
    follow(url);
  });
}

main().catch((err) => {
  console.error('Failed to download Ollama:', err.message);
  process.exit(1);
});
