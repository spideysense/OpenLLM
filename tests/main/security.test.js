/**
 * Security Tests
 *
 * STORY: Trial/shared keys must NOT be able to run shell commands (RCE prevention)
 * STORY: The agent restricts dangerous tools to owner keys only
 */

import { describe, it, expect, vi } from 'vitest';

describe('Security: dangerous tool gating', () => {
  it('run_command is in the dangerous tools list', () => {
    // The agent filters DANGEROUS_TOOLS for non-owner requests.
    // This is a structural guarantee that shell execution is owner-only.
    const agentSrc = require('fs').readFileSync(
      require('path').join(__dirname, '..', '..', 'src', 'main', 'agent.js'), 'utf8'
    );
    expect(agentSrc).toMatch(/DANGEROUS_TOOLS\s*=\s*\[[^\]]*['"]run_command['"]/);
    expect(agentSrc).toMatch(/if\s*\(\s*!isOwner\s*\)/);
  });

  it('gateway passes isOwner to the agent', () => {
    const gwSrc = require('fs').readFileSync(
      require('path').join(__dirname, '..', '..', 'src', 'main', 'gateway.js'), 'utf8'
    );
    expect(gwSrc).toMatch(/isOwner:\s*apikeys\.isOwnerKey\(authToken\)/);
  });

  it('publish-artifact requires authentication', () => {
    const gwSrc = require('fs').readFileSync(
      require('path').join(__dirname, '..', '..', 'src', 'main', 'gateway.js'), 'utf8'
    );
    // The publish handler must validate a key before accepting HTML
    const publishBlock = gwSrc.slice(gwSrc.indexOf("'/publish-artifact'"), gwSrc.indexOf("'/publish-artifact'") + 800);
    expect(publishBlock).toMatch(/validateKey/);
    expect(publishBlock).toMatch(/Authentication required/);
  });

  it('gateway binds to localhost only', () => {
    const gwSrc = require('fs').readFileSync(
      require('path').join(__dirname, '..', '..', 'src', 'main', 'gateway.js'), 'utf8'
    );
    expect(gwSrc).toMatch(/127\.0\.0\.1/);
    // Must not bind to 0.0.0.0 (all interfaces)
    expect(gwSrc).not.toMatch(/listen\([^,]+,\s*['"]0\.0\.0\.0['"]/);
  });

  it('CORS is not a wildcard', () => {
    const gwSrc = require('fs').readFileSync(
      require('path').join(__dirname, '..', '..', 'src', 'main', 'gateway.js'), 'utf8'
    );
    expect(gwSrc).toMatch(/allowedOrigins/);
    expect(gwSrc).not.toMatch(/Access-Control-Allow-Origin['"],\s*['"]\*['"]/);
  });

  it('rate limiting is enabled', () => {
    const gwSrc = require('fs').readFileSync(
      require('path').join(__dirname, '..', '..', 'src', 'main', 'gateway.js'), 'utf8'
    );
    expect(gwSrc).toMatch(/checkRateLimit/);
  });
});
