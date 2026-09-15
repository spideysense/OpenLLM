import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const script = fs.readFileSync('scripts/release-mac.js', 'utf8');
function prepare({ platform = 'darwin', version = '0.8.3', credentials = true, failBuild = false } = {}) {
  const calls = [];
  const run = () => vm.runInNewContext(script, {
    process: { platform, argv: ['node', 'release-mac.js', version], env: credentials ? { APPLE_ID: 'fixture', APPLE_APP_SPECIFIC_PASSWORD: 'fixture', APPLE_TEAM_ID: 'fixture' } : {} },
    console: { log() {} },
    require: id => {
      if (id === 'fs') return { existsSync: () => false };
      if (id === '../package.json') return { version: '0.8.3' };
      if (id === 'child_process') return { execFileSync: (command,args) => { calls.push({ command,args }); if (failBuild && command === 'npx') throw new Error('Signing failed'); } };
      if (['path','os'].includes(id)) return require(id);
      throw new Error('Unexpected dependency: ' + id);
    },
  });
  return { run, calls };
}

describe('local signed release preparation', () => {
  it('validates the staple only after the signed build completes and performs no publishing', () => {
    const { run, calls } = prepare(); run();
    const build = calls.findIndex(c => c.command === 'npx');
    expect(calls[build].args).toContain('-c.forceCodeSigning=true');
    expect(calls[build].args.slice(-3, -1)).toEqual(['--publish','never']);
    expect(calls[build + 1]).toEqual({ command: 'xcrun', args: ['stapler', 'validate', 'dist/Aspen-mac.dmg'] });
    expect(calls.some(c => c.command === 'git' || c.command === 'gh')).toBe(false);
  });
  it('fails before building when source and requested versions differ', () => { const f = prepare({ version: '999' }); expect(f.run).toThrow('Commit the intended'); expect(f.calls).toEqual([]); });
  it('fails before building without notarization credentials', () => { const f = prepare({ credentials: false }); expect(f.run).toThrow('required'); expect(f.calls).toEqual([]); });
  it('never accepts artifacts after a failed signing step', () => { const f = prepare({ failBuild: true }); expect(f.run).toThrow('Signing failed'); expect(f.calls.some(c => c.command === 'xcrun')).toBe(false); });
  it('requires the native signing platform', () => { const f = prepare({ platform: 'linux' }); expect(f.run).toThrow('on a Mac'); expect(f.calls).toEqual([]); });
});
