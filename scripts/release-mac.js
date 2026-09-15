#!/usr/bin/env node
// Local signed artifact preparation. Publishing is centralized in release.yml,
// which verifies every platform and creates a draft only after all gates pass.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
if (process.platform !== 'darwin') throw new Error('Prepare macOS artifacts on a Mac with a Developer ID certificate.');
const envFile = path.join(require('os').homedir(), '.aspen-release-env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.+)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
}
const version = require('../package.json').version;
if (process.argv[2] && process.argv[2] !== version) throw new Error('Commit the intended package version before preparing release artifacts.');
for (const name of ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']) if (!process.env[name]) throw new Error(`${name} is required for notarization.`);
execFileSync('npm', ['ci'], { stdio: 'inherit' });
execFileSync('npm', ['test'], { stdio: 'inherit' });
execFileSync('npm', ['run', 'build:renderer'], { stdio: 'inherit' });
execFileSync('npm', ['run', 'build:household'], { stdio: 'inherit' });
execFileSync('npx', ['electron-builder', '--mac', '--publish', 'never', '-c.forceCodeSigning=true'], { stdio: 'inherit' });
execFileSync('xcrun', ['stapler', 'validate', 'dist/Aspen-mac.dmg'], { stdio: 'inherit' });
console.log('Signed macOS artifacts prepared in dist/. Use Signed release qualification to stage a verified multi-platform draft.');
