/**
 * src/main/mcp-client.js — Aspen's built-in MCP (Model Context Protocol) client.
 *
 * MCP is the open standard for giving an AI tools. An "MCP server" is a small
 * program exposing tools (e.g. the GitHub server exposes list_repos, create_issue).
 * This client spawns those servers as child processes, speaks the MCP protocol to
 * them over stdio (JSON-RPC 2.0), discovers their tools, and calls them on demand.
 *
 * It is intentionally thin: it connects to servers, lists their tools, and invokes
 * them. Tool *selection* is done by the local model via Aspen's existing agent loop
 * (see tools.js / agent.js) — this module just connects and executes.
 *
 * PRIVACY NOTE: where a server's data goes depends entirely on the server.
 *   - filesystem / git servers run locally and touch only the user's machine.
 *   - github / gmail / slack servers make network calls to those services and
 *     require the user's token. That token is passed to the server process via its
 *     environment and never leaves the user's machine except in requests the server
 *     itself makes directly to that service's API. Aspen's servers see none of it.
 */

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

// One live connection per enabled connector id.
const connections = new Map(); // id -> { client, transport, tools: [...] }

/**
 * Connect to a single MCP server.
 * @param {string} id        connector id, e.g. 'github'
 * @param {string} command   executable, e.g. 'npx'
 * @param {string[]} args    e.g. ['-y','@modelcontextprotocol/server-github']
 * @param {object} env       extra env vars for the server process (e.g. token)
 * @returns {Promise<{tools:Array}>}
 */
async function connectServer(id, command, args = [], env = {}) {
  if (connections.has(id)) await disconnectServer(id);

  const transport = new StdioClientTransport({
    command,
    args,
    // Inherit Aspen's env so PATH/node resolution works, plus the connector's own
    // secrets (tokens). These live only in this child process's environment.
    env: { ...process.env, ...env },
  });

  const client = new Client(
    { name: 'aspen', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);

  // Discover the tools this server exposes.
  const listed = await client.listTools();
  const tools = (listed?.tools || []).map((t) => ({
    name: t.name,
    description: t.description || '',
    inputSchema: t.inputSchema || { type: 'object', properties: {} },
  }));

  connections.set(id, { client, transport, tools });
  return { tools };
}

async function disconnectServer(id) {
  const conn = connections.get(id);
  if (!conn) return;
  try { await conn.client.close(); } catch {}
  try { await conn.transport.close(); } catch {}
  connections.delete(id);
}

async function disconnectAll() {
  await Promise.all([...connections.keys()].map(disconnectServer));
}

// All tools across all connected servers, tagged with their connector id.
function listAllTools() {
  const out = [];
  for (const [id, conn] of connections) {
    for (const t of conn.tools) out.push({ connectorId: id, ...t });
  }
  return out;
}

/**
 * Call a tool on a specific connected server.
 * @returns {Promise<string>} a text result (never throws — returns an error string).
 */
async function callTool(connectorId, toolName, args = {}) {
  const conn = connections.get(connectorId);
  if (!conn) return `Connector "${connectorId}" is not connected.`;
  try {
    const res = await conn.client.callTool({ name: toolName, arguments: args || {} });
    // MCP returns content as an array of blocks; flatten the text ones.
    const parts = (res?.content || [])
      .map((b) => (b.type === 'text' ? b.text : `[${b.type}]`))
      .filter(Boolean);
    const text = parts.join('\n').trim();
    if (res?.isError) return `Tool error: ${text || 'unknown error'}`;
    return text || '(no output)';
  } catch (e) {
    return `Tool ${toolName} failed: ${e.message}`;
  }
}

function isConnected(id) { return connections.has(id); }
function connectedIds() { return [...connections.keys()]; }

module.exports = {
  connectServer,
  disconnectServer,
  disconnectAll,
  listAllTools,
  callTool,
  isConnected,
  connectedIds,
};
