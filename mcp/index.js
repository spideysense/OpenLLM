#!/usr/bin/env node

/**
 * LLM Bear MCP Server
 *
 * Exposes your local AI models to any MCP-compatible agent (Claude Desktop,
 * Cursor, Continue.dev, etc.) via the Model Context Protocol.
 *
 * Connects to Ollama (localhost:11434) or the LLM Bear gateway (localhost:4000).
 *
 * Usage:
 *   npx @llmbear/mcp-server
 *   node mcp/index.js
 *
 * Claude Desktop config (~/.claude/claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "llmbear": {
 *         "command": "node",
 *         "args": ["/path/to/OpenLLM/mcp/index.js"]
 *       }
 *     }
 *   }
 */

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");

// ═══════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
const GATEWAY_HOST = process.env.LLMBEAR_GATEWAY || "http://127.0.0.1:4000";
const GATEWAY_KEY = process.env.LLMBEAR_API_KEY || "";
const DEFAULT_MODEL = process.env.LLMBEAR_MODEL || "";

// ═══════════════════════════════════════════════════
// HTTP helpers
// ═══════════════════════════════════════════════════

async function ollamaFetch(path, options = {}) {
  const url = `${OLLAMA_HOST}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ollama ${res.status}: ${text}`);
  }
  return res.json();
}

async function gatewayFetch(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...options.headers };
  if (GATEWAY_KEY) headers["Authorization"] = `Bearer ${GATEWAY_KEY}`;

  const url = `${GATEWAY_HOST}${path}`;
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gateway ${res.status}: ${text}`);
  }
  return res.json();
}

// Try gateway first, fall back to Ollama
async function smartFetch(gatewayPath, ollamaPath, options = {}) {
  try {
    return await gatewayFetch(gatewayPath, options);
  } catch {
    return await ollamaFetch(ollamaPath, options);
  }
}

// ═══════════════════════════════════════════════════
// Tool implementations
// ═══════════════════════════════════════════════════

async function chat(model, messages, temperature = 0.7) {
  const resolvedModel = model || DEFAULT_MODEL;
  if (!resolvedModel) {
    // Try to get the first installed model
    const tags = await ollamaFetch("/api/tags");
    if (tags.models?.length > 0) {
      return chatWithModel(tags.models[0].name, messages, temperature);
    }
    throw new Error("No model specified and no models installed. Use pull_model first.");
  }
  return chatWithModel(resolvedModel, messages, temperature);
}

async function chatWithModel(model, messages, temperature) {
  // Try gateway (OpenAI format) first
  try {
    const data = await gatewayFetch("/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model, messages, temperature, stream: false }),
    });
    return data.choices?.[0]?.message?.content || "";
  } catch {
    // Fall back to Ollama native API
    const data = await ollamaFetch("/api/chat", {
      method: "POST",
      body: JSON.stringify({ model, messages, stream: false, options: { temperature } }),
    });
    return data.message?.content || "";
  }
}

async function listModels() {
  const data = await ollamaFetch("/api/tags");
  return (data.models || []).map((m) => ({
    name: m.name,
    size: m.size,
    sizeGB: (m.size / 1e9).toFixed(1),
    family: m.details?.family || "unknown",
    parameters: m.details?.parameter_size || "unknown",
    quantization: m.details?.quantization_level || "unknown",
    modified: m.modified_at,
  }));
}

async function pullModel(model) {
  // Use non-streaming pull
  const res = await fetch(`${OLLAMA_HOST}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: model, stream: false }),
  });
  if (!res.ok) throw new Error(`Failed to pull ${model}: ${res.status}`);
  const data = await res.json();
  return { success: true, status: data.status || "success" };
}

async function deleteModel(model) {
  const res = await fetch(`${OLLAMA_HOST}/api/delete`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: model }),
  });
  if (!res.ok) throw new Error(`Failed to delete ${model}: ${res.status}`);
  return { success: true };
}

async function getModelInfo(model) {
  return ollamaFetch("/api/show", {
    method: "POST",
    body: JSON.stringify({ name: model }),
  });
}

function getSystemInfo() {
  const os = require("os");
  return {
    platform: os.platform(),
    arch: os.arch(),
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model || "unknown",
    totalRAMGB: Math.round(os.totalmem() / 1e9),
    freeRAMGB: Math.round(os.freemem() / 1e9),
    hostname: os.hostname(),
    ollamaHost: OLLAMA_HOST,
    gatewayHost: GATEWAY_HOST,
  };
}

// ═══════════════════════════════════════════════════
// Curated model catalog
// ═══════════════════════════════════════════════════

const CATALOG = [
  { name: "llama3.2:3b", category: "general", size: "2.0 GB", description: "Fast general-purpose model, good for quick tasks" },
  { name: "qwen2.5:7b", category: "general", size: "4.7 GB", description: "Strong all-rounder, great balance of quality and speed" },
  { name: "qwen2.5:32b", category: "general", size: "19 GB", description: "Near GPT-4 quality, needs 32GB+ RAM" },
  { name: "llama3.3", category: "general", size: "40 GB", description: "Meta's flagship, needs 64GB+ RAM" },
  { name: "qwen2.5-coder:7b", category: "coding", size: "4.7 GB", description: "Excellent code generation and debugging" },
  { name: "qwen2.5-coder:32b", category: "coding", size: "19 GB", description: "Top-tier coding model, rivals GPT-4 for code" },
  { name: "deepseek-r1:7b", category: "reasoning", size: "4.7 GB", description: "Strong chain-of-thought reasoning" },
  { name: "deepseek-r1:14b", category: "reasoning", size: "9 GB", description: "Advanced reasoning and math" },
  { name: "deepseek-r1:32b", category: "reasoning", size: "19 GB", description: "Best open-source reasoning model" },
  { name: "gemma2:9b", category: "creative", size: "5.4 GB", description: "Google's model, great for creative writing" },
];

// ═══════════════════════════════════════════════════
// MCP Server
// ═══════════════════════════════════════════════════

const server = new Server(
  { name: "llmbear", version: "0.1.0" },
  { capabilities: { tools: {}, resources: {} } }
);

// ── Tools ──

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "chat",
      description:
        "Send a message to a local AI model running on this machine via LLM Bear / Ollama. Returns the model's response. Use this to get AI assistance from a locally-running open source model.",
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string", description: "The message to send to the model" },
          model: {
            type: "string",
            description:
              "Model to use (e.g. 'qwen2.5:7b', 'llama3.2:3b'). Leave empty for the default or first installed model.",
          },
          system: {
            type: "string",
            description: "Optional system prompt to set the model's behavior",
          },
          temperature: {
            type: "number",
            description: "Sampling temperature (0.0-2.0, default 0.7)",
          },
        },
        required: ["message"],
      },
    },
    {
      name: "list_models",
      description:
        "List all AI models currently installed on this machine. Shows name, size, family, and parameter count.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "browse_catalog",
      description:
        "Browse the curated catalog of recommended open source models. Shows name, category, size, and description. Use this to find good models to install.",
      inputSchema: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: ["general", "coding", "reasoning", "creative", "all"],
            description: "Filter by category (default: all)",
          },
        },
      },
    },
    {
      name: "pull_model",
      description:
        "Download and install a new AI model. This may take several minutes depending on model size and internet speed. Use browse_catalog to see available models.",
      inputSchema: {
        type: "object",
        properties: {
          model: {
            type: "string",
            description: "Model name to download (e.g. 'qwen2.5:7b', 'llama3.2:3b')",
          },
        },
        required: ["model"],
      },
    },
    {
      name: "delete_model",
      description: "Delete an installed model to free up disk space.",
      inputSchema: {
        type: "object",
        properties: {
          model: { type: "string", description: "Model name to delete" },
        },
        required: ["model"],
      },
    },
    {
      name: "model_info",
      description:
        "Get detailed information about a specific installed model, including its template, parameters, license, and system prompt.",
      inputSchema: {
        type: "object",
        properties: {
          model: { type: "string", description: "Model name to inspect" },
        },
        required: ["model"],
      },
    },
    {
      name: "system_info",
      description:
        "Get information about the host system: CPU, RAM, platform, and LLM Bear/Ollama connection status.",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "chat": {
        const messages = [];
        if (args.system) messages.push({ role: "system", content: args.system });
        messages.push({ role: "user", content: args.message });
        const response = await chat(args.model || "", messages, args.temperature || 0.7);
        return { content: [{ type: "text", text: response }] };
      }

      case "list_models": {
        const models = await listModels();
        if (models.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No models installed yet. Use browse_catalog to see available models, then pull_model to install one.\n\nRecommended starter: qwen2.5:7b (4.7 GB, great all-rounder)",
              },
            ],
          };
        }
        const list = models
          .map((m) => `• ${m.name} — ${m.sizeGB} GB (${m.family}, ${m.parameters}, ${m.quantization})`)
          .join("\n");
        return {
          content: [{ type: "text", text: `Installed models:\n${list}` }],
        };
      }

      case "browse_catalog": {
        const cat = args.category || "all";
        const filtered = cat === "all" ? CATALOG : CATALOG.filter((m) => m.category === cat);
        const list = filtered
          .map((m) => `• ${m.name} [${m.category}] — ${m.size}\n  ${m.description}`)
          .join("\n\n");
        return {
          content: [
            {
              type: "text",
              text: `Available models${cat !== "all" ? ` (${cat})` : ""}:\n\n${list}\n\nUse pull_model to install any of these.`,
            },
          ],
        };
      }

      case "pull_model": {
        const result = await pullModel(args.model);
        return {
          content: [{ type: "text", text: `Successfully installed ${args.model}. You can now use it with the chat tool.` }],
        };
      }

      case "delete_model": {
        await deleteModel(args.model);
        return {
          content: [{ type: "text", text: `Deleted ${args.model}.` }],
        };
      }

      case "model_info": {
        const info = await getModelInfo(args.model);
        const details = [
          `Model: ${args.model}`,
          `Family: ${info.details?.family || "unknown"}`,
          `Parameters: ${info.details?.parameter_size || "unknown"}`,
          `Quantization: ${info.details?.quantization_level || "unknown"}`,
          `Format: ${info.details?.format || "unknown"}`,
        ];
        if (info.license) details.push(`License: ${info.license.slice(0, 200)}...`);
        if (info.system) details.push(`System prompt: ${info.system.slice(0, 300)}`);
        return {
          content: [{ type: "text", text: details.join("\n") }],
        };
      }

      case "system_info": {
        const info = getSystemInfo();
        // Check Ollama connectivity
        let ollamaStatus = "offline";
        try {
          await ollamaFetch("/api/tags");
          ollamaStatus = "running";
        } catch {
          ollamaStatus = "not reachable";
        }

        let gatewayStatus = "offline";
        try {
          await gatewayFetch("/v1/models");
          gatewayStatus = "running";
        } catch {
          gatewayStatus = "not reachable";
        }

        return {
          content: [
            {
              type: "text",
              text: [
                `Platform: ${info.platform} (${info.arch})`,
                `CPU: ${info.cpuModel} (${info.cpus} cores)`,
                `RAM: ${info.freeRAMGB} GB free / ${info.totalRAMGB} GB total`,
                `Ollama: ${ollamaStatus} (${info.ollamaHost})`,
                `LLM Bear Gateway: ${gatewayStatus} (${info.gatewayHost})`,
              ].join("\n"),
            },
          ],
        };
      }

      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// ── Resources ──

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: "llmbear://models",
      name: "Installed Models",
      description: "List of all locally installed AI models",
      mimeType: "application/json",
    },
    {
      uri: "llmbear://system",
      name: "System Info",
      description: "Hardware and connectivity information",
      mimeType: "application/json",
    },
    {
      uri: "llmbear://catalog",
      name: "Model Catalog",
      description: "Curated catalog of recommended models",
      mimeType: "application/json",
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  switch (uri) {
    case "llmbear://models": {
      const models = await listModels();
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(models, null, 2) }],
      };
    }
    case "llmbear://system": {
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(getSystemInfo(), null, 2) }],
      };
    }
    case "llmbear://catalog": {
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(CATALOG, null, 2) }],
      };
    }
    default:
      throw new Error(`Unknown resource: ${uri}`);
  }
});

// ── Start ──

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[LLM Bear MCP] Server running on stdio");
}

main().catch((err) => {
  console.error("[LLM Bear MCP] Fatal:", err);
  process.exit(1);
});
