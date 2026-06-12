/**
 * Dependency / build-config guards — added with the Electron 28→42 upgrade
 * (2026-06-12). These lock in the decisions so a stray `npm install` or a
 * copy-paste from old docs can't quietly regress them.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
const major = (range) => parseInt(String(range).replace(/[^\d.]/g, '').split('.')[0], 10);

describe('Electron 42 upgrade is in place', () => {
  it('electron is on major >= 42', () => {
    expect(major(pkg.devDependencies.electron)).toBeGreaterThanOrEqual(42);
  });
  it('electron-builder is on major >= 26 (supports E42 / Node 24)', () => {
    expect(major(pkg.devDependencies['electron-builder'])).toBeGreaterThanOrEqual(26);
  });
  it('@electron/rebuild is on major >= 4 (rebuilds against the new ABI)', () => {
    expect(major(pkg.devDependencies['@electron/rebuild'])).toBeGreaterThanOrEqual(4);
  });
});

describe('robotjs is fully removed (abandoned, will not build on E42)', () => {
  it('is not in dependencies or optionalDependencies', () => {
    expect(pkg.optionalDependencies?.robotjs).toBeUndefined();
    expect(pkg.dependencies?.robotjs).toBeUndefined();
    expect(pkg.devDependencies?.robotjs).toBeUndefined();
  });
  it('has no robotjs asarUnpack entry', () => {
    const unpack = JSON.stringify(pkg.build.asarUnpack || []);
    expect(unpack).not.toMatch(/robotjs/);
  });
  it('computer-use.js does not require robotjs', () => {
    const src = fs.readFileSync(path.resolve('src/main/computer-use.js'), 'utf8');
    expect(src).not.toMatch(/require\(['"]robotjs['"]\)/);
  });
});

describe('macOS Info.plist declares the permission usage strings', () => {
  it('NSMicrophoneUsageDescription is set (askForMediaAccess would crash without it)', () => {
    expect(pkg.build.mac.extendInfo?.NSMicrophoneUsageDescription).toBeTruthy();
  });
  it('the mac signing/notarize config survived the edit', () => {
    expect(pkg.build.mac.notarize?.teamId).toBe('S6UBG93XBS');
    expect(pkg.build.mac.hardenedRuntime).toBe(true);
    expect(pkg.build.mac.entitlements).toMatch(/entitlements\.mac\.plist/);
  });
});
