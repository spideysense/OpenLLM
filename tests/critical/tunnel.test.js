import { describe, it, expect } from 'vitest';
import fs from 'fs';

// Tunnel tests: verify the module structure and release script safety
// (We don't spawn cloudflared in tests — just verify the contract)

describe('Tunnel module contract', () => {
  it('tunnel.js exports start, stop, getPublicUrl, isConnected', () => {
    const src = fs.readFileSync('src/main/tunnel.js', 'utf8');
    expect(src).toContain('start');
    expect(src).toContain('stop');
    expect(src).toContain('getPublicUrl');
    expect(src).toContain('isConnected');
    expect(src).toContain('module.exports');
  });

  it('tunnel uses named Cloudflare tunnel (stable URL, not ephemeral)', () => {
    const src = fs.readFileSync('src/main/tunnel.js', 'utf8');
    expect(src).toContain('runonaspen.com');
    expect(src).toContain('tunnelToken');
    expect(src).toContain('tunnelUrl');
  });

  it('tunnel stores URL persistently in electron-store', () => {
    const src = fs.readFileSync('src/main/tunnel.js', 'utf8');
    expect(src).toContain("store.get('tunnelUrl')");
    expect(src).toContain("store.set");
  });

  it('tunnel notifies renderer of status changes', () => {
    const src = fs.readFileSync('src/main/tunnel.js', 'utf8');
    expect(src).toContain('notifyStatus');
  });

  it('tunnel is started on app ready in index.js', () => {
    const src = fs.readFileSync('src/main/index.js', 'utf8');
    expect(src).toContain('tunnel.start');
  });

  it('tunnel restart IPC handler exists', () => {
    const src = fs.readFileSync('src/main/index.js', 'utf8');
    expect(src).toContain('tunnel:restart');
  });
});

describe('Web app tunnel connectivity', () => {
  it('web app has offline banner that shows when tunnel is down', () => {
    const src = fs.readFileSync('site/app/index.html', 'utf8');
    expect(src).toContain('offline-banner');
    expect(src).toContain('offline');
  });

  it('web app polls tunnel status every 60 seconds (throttled to cut box contention)', () => {
    const src = fs.readFileSync('site/app/index.html', 'utf8');
    expect(src).toContain('60000');
    expect(src).toContain('checkStatus');
  });

  it('web app checks /v1/models endpoint for tunnel health', () => {
    const src = fs.readFileSync('site/app/index.html', 'utf8');
    expect(src).toContain('/v1/models');
  });
});
