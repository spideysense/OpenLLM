/**
 * src/main/connectors.js — connector registry, secure token storage, and
 * connect/disconnect orchestration for Aspen's MCP integrations.
 *
 * Each connector describes:
 *   - how to launch its MCP server (command/args)
 *   - whether it needs a secret (token) and which env var the server reads it from
 *   - HONEST data-flow metadata shown in the UI: what runs locally, what reaches
 *     out, what is sent, and what is stored. We never soften this — users deserve
 *     to know exactly where their data goes.
 *
 * Tokens are encrypted with Electron's safeStorage (backed by the OS keychain:
 * Keychain on macOS, libsecret on Linux, DPAPI on Windows) and only the encrypted
 * blob is written to disk. Plaintext tokens never touch the filesystem.
 */

const { safeStorage } = require('./runtime');
const store = require('./store');
const mcp = require('./mcp-client');

// ── Registry ────────────────────────────────────────────────────────────────
// dataFlow is displayed verbatim in the Connectors UI. Keep it truthful.
const CONNECTORS = {
  github: {
    id: 'github',
    label: 'GitHub',
    icon: 'github',
    description: 'Let Aspen read your repos, issues, and pull requests, and create issues or PRs.',
    command: 'github-remote',
    args: [],
    needsToken: true,
    tokenEnvVar: 'GITHUB_PERSONAL_ACCESS_TOKEN',
    tokenHelp: 'Create a token at github.com/settings/tokens (classic or fine-grained). Prefer a fine-grained token limited to the repositories and permissions you want Aspen to use.',
    dataFlow: {
      runsLocally: false,
      reachesOut: 'api.githubcopilot.com (GitHub’s official MCP service)',
      shortLabel: '⚠ Connects to GitHub — requests go to GitHub’s hosted MCP service using your token.',
      sends: 'Your GitHub token (to authenticate) and whatever repo, issue, or PR data the AI asks for, sent directly from your machine to GitHub\'s hosted MCP service.',
      stays: 'Your token is stored encrypted in your operating system\'s keychain on this machine. Aspen\'s servers never see it. The AI model runs locally — your prompts are not sent to Aspen or any third party.',
      note: 'GitHub is a cloud service, so using this connector necessarily sends requests to github.com. That is the only data that leaves your machine, and it goes straight to GitHub, not through Aspen.',
    },
  },
  // Future cloud connectors (gmail, slack) follow the same shape.
  // Future LOCAL connectors (filesystem, git) will set runsLocally:true,
  // reachesOut:null, and need no token.
};

function listConnectors() {
  return Object.values(CONNECTORS).map((c) => ({
    id: c.id,
    label: c.label,
    icon: c.icon,
    description: c.description,
    needsToken: c.needsToken,
    tokenHelp: c.tokenHelp || '',
    dataFlow: c.dataFlow,
    connected: mcp.isConnected(c.id),
    hasToken: hasToken(c.id),
  }));
}

// ── Secure token storage ──────────────────────────────────────────────────────
const TOKEN_STORE_KEY = 'connectorTokens'; // { [id]: base64(encrypted) }

function hasToken(id) {
  const all = store.get(TOKEN_STORE_KEY) || {};
  return !!all[id];
}

function saveToken(id, token) {
  if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') {
    throw new Error('Secure storage is unavailable on this system, so Aspen will not save your token in plaintext. You can still connect by entering the token each session.');
  }
  const all = store.get(TOKEN_STORE_KEY) || {};
  all[id] = safeStorage.encryptString(token).toString('base64');
  store.set(TOKEN_STORE_KEY, all);
}

function readToken(id) {
  const all = store.get(TOKEN_STORE_KEY) || {};
  const blob = all[id];
  if (!blob) return null;
  try {
    return safeStorage.decryptString(Buffer.from(blob, 'base64'));
  } catch {
    return null;
  }
}

function deleteToken(id) {
  const all = store.get(TOKEN_STORE_KEY) || {};
  delete all[id];
  store.set(TOKEN_STORE_KEY, all);
}

// ── Connect / disconnect ───────────────────────────────────────────────────────
async function connect(id, oneTimeToken) {
  const c = CONNECTORS[id];
  if (!c) throw new Error(`Unknown connector: ${id}`);

  const env = {};
  if (c.needsToken) {
    const token = oneTimeToken || readToken(id);
    if (!token) throw new Error(`${c.label} requires a token. Add one to connect.`);
    env[c.tokenEnvVar] = token;
    // Persist only if the caller passed a fresh token (and storage is available).
    if (oneTimeToken && safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend?.() !== 'basic_text') saveToken(id, oneTimeToken);
  }

  const { tools } = await mcp.connectServer(id, c.command, c.args, env);
  store.set('connectorEndpointApproval', { ...(store.get('connectorEndpointApproval') || {}), [id]: c.command });
  return { id, connected: true, toolCount: tools.length };
}

async function disconnect(id) {
  await mcp.disconnectServer(id);
  return { id, connected: false };
}

// Reconnect any connectors that have a stored token (called at app startup).
async function reconnectSaved() {
  const results = [];
  for (const c of Object.values(CONNECTORS)) {
    if (c.needsToken && hasToken(c.id) && store.get('connectorEndpointApproval')?.[c.id] === c.command) {
      try { results.push(await connect(c.id)); }
      catch (e) { results.push({ id: c.id, connected: false, error: e.message }); }
    }
  }
  return results;
}

module.exports = {
  CONNECTORS,
  listConnectors,
  connect,
  disconnect,
  reconnectSaved,
  saveToken,
  deleteToken,
  hasToken,
};
