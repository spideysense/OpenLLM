/**
 * Update-button fix (2026-06-12).
 *
 * Bug: the "Update ready" banner is shared by two update systems — the full-app
 * electron-updater (source:'app') and the renderer hot-updater (source:'hot') —
 * but the click was hardwired to updater.install(), which silently no-ops unless
 * electron-updater had downloaded a full build. Result: a dead button.
 *
 * Fix: tag each status with a source, dispatch the click by source, return a
 * result from install(), and fall back to the releases page so the click is
 * never dead.
 *
 * Source-level checks — updater.js require()s the real `electron` package at
 * load time (binary not resolvable under vitest), so the repo tests it
 * structurally (see tests/main/core.test.js).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const updaterSrc = fs.readFileSync(path.resolve('src/main/updater.js'), 'utf8');
const hotSrc = fs.readFileSync(path.resolve('src/main/hot-updater.js'), 'utf8');
const indexSrc = fs.readFileSync(path.resolve('src/main/index.js'), 'utf8');
const sidebar = fs.readFileSync(path.resolve('src/renderer/components/Sidebar.jsx'), 'utf8');
const preload = fs.readFileSync(path.resolve('src/preload/index.js'), 'utf8');

describe('updater.installUpdate returns a result instead of dead-ending', () => {
  it('returns not-downloaded (and re-checks) when nothing is staged', () => {
    expect(updaterSrc).toMatch(/if\s*\(\s*!updateReady\s*\)/);
    expect(updaterSrc).toMatch(/reason:\s*'not-downloaded'/);
    const block = updaterSrc.slice(updaterSrc.indexOf('function installUpdate'), updaterSrc.indexOf('function installUpdate') + 500);
    expect(block).toMatch(/checkForUpdates\(\)/);
  });
  it('wraps quitAndInstall in try/catch and reports failure', () => {
    expect(updaterSrc).toMatch(/quitAndInstall\(false,\s*true\)/);
    expect(updaterSrc).toMatch(/reason:\s*'install-failed'/);
  });
  it('the install IPC returns the result (not a bare true)', () => {
    expect(indexSrc).toMatch(/return updater\.installUpdate\(\)/);
  });
});

describe('Guaranteed fallback: open the releases page', () => {
  it('openReleasesPage uses shell.openExternal to the latest release', () => {
    expect(updaterSrc).toMatch(/openReleasesPage/);
    expect(updaterSrc).toMatch(/shell\.openExternal/);
    expect(updaterSrc).toMatch(/releases\/latest/);
  });
  it('is exposed via IPC + preload', () => {
    expect(indexSrc).toMatch(/'updater:openReleases'/);
    expect(preload).toMatch(/openReleases:/);
  });
});

describe('Update banner disambiguates the two updaters', () => {
  it('electron-updater tags its status source:app', () => {
    expect(updaterSrc).toMatch(/source:\s*'app'/);
  });
  it('hot-updater tags its status source:hot', () => {
    expect(hotSrc).toMatch(/source:\s*'hot'/);
  });
  it('sidebar dispatches the click by source (hot -> reload, app -> install)', () => {
    expect(sidebar).toMatch(/updateStatus\?\.source === 'hot'/);
    expect(sidebar).toMatch(/hotUpdater\.reload\(\)/);
    expect(sidebar).toMatch(/updater\.install\(\)/);
  });
  it('sidebar falls back to the download page when install cannot proceed', () => {
    expect(sidebar).toMatch(/res\.ok === false|!res/);
    expect(sidebar).toMatch(/openReleases\(\)/);
  });
});
