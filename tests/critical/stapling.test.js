import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const script = fs.readFileSync(path.resolve('scripts/release-mac.js'), 'utf8');

describe('Release Script — Stapling', () => {
  it('script exists', () => {
    expect(fs.existsSync(path.resolve('scripts/release-mac.js'))).toBe(true);
  });

  it('validates staple before uploading', () => {
    const validateIdx = script.indexOf('xcrun stapler validate');
    const uploadIdx = script.indexOf('// 4. Upload');
    expect(validateIdx).toBeGreaterThan(0);
    expect(uploadIdx).toBeGreaterThan(0);
    expect(validateIdx).toBeLessThan(uploadIdx);
  });

  it('confirms release is served as latest after upload', () => {
    expect(script).toContain("served 'latest'");
  });

  it('commits version before building', () => {
    expect(script).toContain('Committing version bump');
    expect(script).toContain('git push origin main');
  });

  it('uses --no-git-tag-version', () => {
    expect(script).toContain('no-git-tag-version');
  });

  it('version comes from CLI arg', () => {
    expect(script).toContain('process.argv[2]');
  });

  it('triggers Windows EXE build after Mac release', () => {
    expect(script).toContain('release-windows');
  });
});
