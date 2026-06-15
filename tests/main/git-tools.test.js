import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp'), isPackaged: false },
}));

const secrets = require('../../src/main/secrets.js');
const gitTools = require('../../src/main/git-tools.js');
const gatewayAgent = require('../../src/main/gateway-agent.js');

describe('secrets redaction (token must never leak)', () => {
  it('scrubs a stored token from any string', () => {
    secrets.setSecret('github_token', 'github_pat_TESTSECRET0123456789abcdefghij');
    const leaked = `pushing to https://${secrets.getSecret('github_token')}@github.com/x/y`;
    const safe = secrets.redact(leaked);
    expect(safe).not.toContain('TESTSECRET');
    secrets.deleteSecret('github_token');
  });

  it('scrubs GitHub token shapes even if not stored', () => {
    expect(secrets.redact('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345')).not.toContain('ABCDEFGHIJ');
    expect(secrets.redact('github_pat_11AAA_bbbbbbbbbbbbbbbbbbbbbbbb')).toContain('redacted');
  });

  it('scrubs credentials embedded in an https URL', () => {
    expect(secrets.redact('https://abc123def@github.com/x/y')).toMatch(/redacted/);
  });
});

describe('git-tools guardrails', () => {
  it('parses only github.com repos', () => {
    expect(gitTools.repoSlug('https://github.com/o/n')).toBe('o/n');
    expect(gitTools.repoSlug('https://github.com/o/n.git')).toBe('o/n');
    expect(gitTools.repoSlug('git@github.com:o/n.git')).toBe('o/n');
    expect(gitTools.repoSlug('https://gitlab.com/o/n')).toBe(null);
  });

  it('refuses paths that escape the workspace', () => {
    expect(() => gitTools.safeDir('../../etc')).toThrow();
    expect(() => gitTools.safeDir('ok-folder')).not.toThrow();
  });

  it('embeds the token in the authed URL but the clean URL has none', () => {
    secrets.setSecret('github_token', 'github_pat_ZZZSECRET0123456789abcdef');
    expect(gitTools.authedUrl('o/n')).toContain('github_pat_ZZZSECRET');
    expect(gitTools.cleanUrl('o/n')).not.toContain('github_pat');
    secrets.deleteSecret('github_token');
  });
});

describe('owner-only gating', () => {
  it('classifies all git tools as dangerous (never offered to non-owners)', () => {
    for (const t of ['git_clone', 'git_status', 'git_commit_push']) {
      expect(gatewayAgent.DANGEROUS_TOOLS).toContain(t);
      expect(gatewayAgent.SAFE_TOOLS).not.toContain(t);
    }
  });
});
