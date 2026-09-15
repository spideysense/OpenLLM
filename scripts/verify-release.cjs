#!/usr/bin/env node
// Sigstore verification through GitHub's maintained verifier. Never execute an
// installer before checking its exact file, source commit and workflow identity.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const [artifact, commit] = process.argv.slice(2);
if (!artifact || !/^[a-f0-9]{40}$/.test(commit || '') || !fs.statSync(artifact).isFile()) {
  console.error('Usage: node scripts/verify-release.cjs /path/to/installer FULL_REVIEWED_COMMIT_SHA'); process.exit(1);
}
execFileSync('gh', ['attestation', 'verify', path.resolve(artifact), '--repo', 'spideysense/OpenLLM', '--signer-workflow', 'spideysense/OpenLLM/.github/workflows/release.yml', '--source-digest', commit, '--deny-self-hosted-runners'], { stdio: 'inherit' });
console.log('Artifact provenance verified. Review the platform signature before installation.');
