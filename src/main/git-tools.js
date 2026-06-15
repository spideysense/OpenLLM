// ─────────────────────────────────────────────────────────────────────────────
// Git tools — clone / status / commit+push, owner-only.
// Safety model:
//   • token is injected ONLY at exec time and never persisted in .git/config
//     (clone uses an authed URL, then resets origin to the clean URL; push uses
//     an authed URL passed inline) — exactly how a careful human handles a PAT.
//   • every output is run through secrets.redact() so a token can't leak.
//   • all operations are confined to ~/.aspen/workspaces (no escaping).
//   • destructive operations are not exposed; there is no force/reset/clean path.
// For Vercel-style repos that auto-deploy on push, a successful push IS a deploy.
// ─────────────────────────────────────────────────────────────────────────────
const { execFile } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const secrets = require('./secrets');

const WORKSPACE = path.join(os.homedir(), '.aspen', 'workspaces');

// Resolve a dir inside the workspace; refuse anything that escapes it.
function safeDir(dir) {
  const resolved = path.resolve(WORKSPACE, dir || '.');
  const root = path.resolve(WORKSPACE);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('Path escapes the Aspen workspace');
  }
  return resolved;
}

// Parse "https://github.com/owner/name(.git)" → "owner/name" (also accepts the
// scp-style git@github.com:owner/name form). Only github.com is supported.
function repoSlug(repo) {
  const r = String(repo || '').trim();
  let m = r.match(/^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/i);
  if (m) return m[1];
  m = r.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/i);
  if (m) return m[1];
  m = r.match(/^https:\/\/[^@]+@github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/i); // already-authed
  if (m) return m[1];
  return null;
}
function cleanUrl(slug) { return `https://github.com/${slug}.git`; }
function authedUrl(slug) {
  const token = secrets.getSecret('github_token');
  return token ? `https://${token}@github.com/${slug}.git` : cleanUrl(slug);
}

function git(args, cwd) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 120000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const output = secrets.redact(`${stdout || ''}${stderr || ''}`.trim());
      resolve({ ok: !err, code: err ? (err.code ?? 1) : 0, output });
    });
  });
}

async function gitClone({ repo, dir } = {}) {
  const slug = repoSlug(repo);
  if (!slug) return 'Only https://github.com/<owner>/<name> repositories are supported.';
  fs.mkdirSync(WORKSPACE, { recursive: true });
  const name = dir || slug.split('/')[1];
  const dest = safeDir(name);
  const r = await git(['clone', authedUrl(slug), dest], WORKSPACE);
  if (!r.ok) return `Clone failed:\n${r.output}`;
  // Do NOT leave the token in .git/config — reset origin to the clean URL.
  await git(['remote', 'set-url', 'origin', cleanUrl(slug)], dest);
  return `Cloned ${slug} into workspace folder "${name}".`;
}

async function gitStatus({ dir } = {}) {
  const d = safeDir(dir);
  const r = await git(['status', '--short', '--branch'], d);
  return r.output || '(clean working tree)';
}

async function gitCommitPush({ dir, message, branch } = {}) {
  const d = safeDir(dir);
  if (!message) return 'A commit message is required.';
  const authorName = secrets.getSecret('git_author_name') || 'Aspen';
  const authorEmail = secrets.getSecret('git_author_email') || 'aspen@runonaspen.com';

  await git(['add', '-A'], d);
  const commit = await git(
    ['-c', `user.name=${authorName}`, '-c', `user.email=${authorEmail}`, 'commit', '-m', String(message)],
    d
  );
  if (/nothing to commit/i.test(commit.output)) return 'Nothing to commit — the working tree is clean.';

  // Determine origin slug, then push via an authed URL passed inline (never
  // persisted). Push to the given branch or the current HEAD.
  const remote = await git(['remote', 'get-url', 'origin'], d);
  const slug = repoSlug(remote.output);
  if (!slug) return secrets.redact(`Committed, but could not determine a github.com origin to push to:\n${remote.output}`);
  const target = branch || 'HEAD';
  const push = await git(['push', authedUrl(slug), target], d);
  if (!push.ok) return secrets.redact(`Committed, but push failed:\n${push.output}`);
  return `Committed and pushed to ${slug}. ${/auto-deploy|vercel/i.test('') ? '' : 'If the repo auto-deploys on push, the deploy is now running.'}`.trim();
}

module.exports = {
  WORKSPACE,
  safeDir,
  repoSlug,
  cleanUrl,
  authedUrl,
  gitClone,
  gitStatus,
  gitCommitPush,
};
