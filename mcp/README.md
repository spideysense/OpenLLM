# LLM Bear MCP Server

Use your local AI models from any MCP-compatible agent — Claude Desktop, Cursor, Continue.dev, Cline, and more.

## What it does

This MCP server exposes 7 tools that let external agents interact with your locally-running AI models:

| Tool | Description |
|------|------------|
| `chat` | Send a message to a local model and get a response |
| `list_models` | See all installed models with sizes and details |
| `browse_catalog` | Browse recommended open source models |
| `pull_model` | Download and install a new model |
| `delete_model` | Remove a model to free disk space |
| `model_info` | Get detailed info about a specific model |
| `system_info` | Check hardware, RAM, and service status |

Plus 3 resources: `llmbear://models`, `llmbear://system`, `llmbear://catalog`

## Quick Setup

### Claude Desktop

Add to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "llmbear": {
      "command": "node",
      "args": ["/path/to/OpenLLM/mcp/index.js"]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "llmbear": {
      "command": "node",
      "args": ["/path/to/OpenLLM/mcp/index.js"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add llmbear node /path/to/OpenLLM/mcp/index.js
```

### Any MCP client

```bash
cd mcp && npm install && node index.js
```

The server communicates over stdio using the Model Context Protocol.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Ollama API endpoint |
| `LLMBEAR_GATEWAY` | `http://127.0.0.1:4000` | LLM Bear gateway endpoint |
| `LLMBEAR_API_KEY` | (empty) | API key for gateway auth |
| `LLMBEAR_MODEL` | (empty) | Default model for chat tool |

## Prerequisites

- Node.js 18+
- Ollama installed and running (or LLM Bear app open)
- At least one model installed (`ollama pull qwen2.5:7b`)

## Example Usage

Once connected, an agent can:

```
"What models do I have?" → calls list_models
"Chat with my local AI about React hooks" → calls chat
"Install the DeepSeek reasoning model" → calls pull_model
"How much RAM do I have?" → calls system_info
```

## License

MIT
