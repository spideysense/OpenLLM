/**
 * MCP Server Tests
 *
 * STORY: An agent connects to LLM Bear MCP and can discover tools
 * STORY: An agent can browse the model catalog
 * STORY: The MCP server has valid configuration
 * STORY: Tool schemas are valid for MCP protocol
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const mcpSource = fs.readFileSync(path.resolve('mcp/index.js'), 'utf8');
const mcpPackage = JSON.parse(fs.readFileSync(path.resolve('mcp/package.json'), 'utf8'));

// ═══════════════════════════════════════════════════
// MCP Package Configuration
// ═══════════════════════════════════════════════════

describe('MCP: Package configuration', () => {
  it('should have correct package name', () => {
    expect(mcpPackage.name).toBe('@llmbear/mcp-server');
  });

  it('should have a bin entry for CLI usage', () => {
    expect(mcpPackage.bin).toHaveProperty('llmbear-mcp');
  });

  it('should depend on @modelcontextprotocol/sdk', () => {
    expect(mcpPackage.dependencies).toHaveProperty('@modelcontextprotocol/sdk');
  });

  it('should require Node 18+', () => {
    expect(mcpPackage.engines.node).toContain('18');
  });

  it('should be MIT licensed', () => {
    expect(mcpPackage.license).toBe('MIT');
  });
});

// ═══════════════════════════════════════════════════
// MCP Tool Definitions
// ═══════════════════════════════════════════════════

describe('MCP: Tool definitions', () => {
  it('should expose chat tool', () => {
    expect(mcpSource).toContain('name: "chat"');
    expect(mcpSource).toContain('"message"');
  });

  it('should expose list_models tool', () => {
    expect(mcpSource).toContain('name: "list_models"');
  });

  it('should expose browse_catalog tool', () => {
    expect(mcpSource).toContain('name: "browse_catalog"');
    expect(mcpSource).toContain('category');
  });

  it('should expose pull_model tool', () => {
    expect(mcpSource).toContain('name: "pull_model"');
  });

  it('should expose delete_model tool', () => {
    expect(mcpSource).toContain('name: "delete_model"');
  });

  it('should expose model_info tool', () => {
    expect(mcpSource).toContain('name: "model_info"');
  });

  it('should expose system_info tool', () => {
    expect(mcpSource).toContain('name: "system_info"');
  });

  it('should define exactly 7 tools', () => {
    const toolNames = mcpSource.match(/name: "(?:chat|list_models|browse_catalog|pull_model|delete_model|model_info|system_info)"/g);
    // Each tool name appears twice (once in definition, once in switch), so unique count
    const unique = new Set(toolNames.map((t) => t.match(/"(.+)"/)[1]));
    expect(unique.size).toBe(7);
  });
});

// ═══════════════════════════════════════════════════
// MCP Resources
// ═══════════════════════════════════════════════════

describe('MCP: Resource definitions', () => {
  it('should expose llmbear://models resource', () => {
    expect(mcpSource).toContain('llmbear://models');
  });

  it('should expose llmbear://system resource', () => {
    expect(mcpSource).toContain('llmbear://system');
  });

  it('should expose llmbear://catalog resource', () => {
    expect(mcpSource).toContain('llmbear://catalog');
  });

  it('should return JSON mime type for resources', () => {
    expect(mcpSource).toContain('application/json');
  });
});

// ═══════════════════════════════════════════════════
// Model Catalog
// ═══════════════════════════════════════════════════

describe('MCP: Model catalog', () => {
  it('should include general purpose models', () => {
    expect(mcpSource).toContain('llama3.2:3b');
    expect(mcpSource).toContain('qwen2.5:7b');
  });

  it('should include coding models', () => {
    expect(mcpSource).toContain('qwen2.5-coder');
  });

  it('should include reasoning models', () => {
    expect(mcpSource).toContain('deepseek-r1');
  });

  it('should include creative models', () => {
    expect(mcpSource).toContain('gemma2:9b');
  });

  it('should have 4 categories', () => {
    expect(mcpSource).toContain('"general"');
    expect(mcpSource).toContain('"coding"');
    expect(mcpSource).toContain('"reasoning"');
    expect(mcpSource).toContain('"creative"');
  });

  it('should include size info for all catalog entries', () => {
    // Every catalog entry should have a GB size
    const gbMatches = mcpSource.match(/size: "\d+\.?\d* GB"/g) || [];
    expect(gbMatches.length).toBeGreaterThanOrEqual(8);
  });
});

// ═══════════════════════════════════════════════════
// Connection Configuration
// ═══════════════════════════════════════════════════

describe('MCP: Connection defaults', () => {
  it('should default to Ollama on localhost:11434', () => {
    expect(mcpSource).toContain('http://127.0.0.1:11434');
  });

  it('should default to gateway on localhost:4000', () => {
    expect(mcpSource).toContain('http://127.0.0.1:4000');
  });

  it('should support OLLAMA_HOST env var', () => {
    expect(mcpSource).toContain('process.env.OLLAMA_HOST');
  });

  it('should support LLMBEAR_GATEWAY env var', () => {
    expect(mcpSource).toContain('process.env.LLMBEAR_GATEWAY');
  });

  it('should support LLMBEAR_API_KEY env var', () => {
    expect(mcpSource).toContain('process.env.LLMBEAR_API_KEY');
  });

  it('should support LLMBEAR_MODEL env var', () => {
    expect(mcpSource).toContain('process.env.LLMBEAR_MODEL');
  });
});

// ═══════════════════════════════════════════════════
// Protocol Compliance
// ═══════════════════════════════════════════════════

describe('MCP: Protocol compliance', () => {
  it('should use StdioServerTransport', () => {
    expect(mcpSource).toContain('StdioServerTransport');
  });

  it('should handle ListToolsRequestSchema', () => {
    expect(mcpSource).toContain('ListToolsRequestSchema');
  });

  it('should handle CallToolRequestSchema', () => {
    expect(mcpSource).toContain('CallToolRequestSchema');
  });

  it('should handle ListResourcesRequestSchema', () => {
    expect(mcpSource).toContain('ListResourcesRequestSchema');
  });

  it('should handle ReadResourceRequestSchema', () => {
    expect(mcpSource).toContain('ReadResourceRequestSchema');
  });

  it('should return isError: true on failures', () => {
    expect(mcpSource).toContain('isError: true');
  });

  it('should use proper MCP content format', () => {
    expect(mcpSource).toContain('type: "text"');
    expect(mcpSource).toContain('content: [');
  });

  it('should declare tools and resources capabilities', () => {
    expect(mcpSource).toContain('capabilities:');
    expect(mcpSource).toContain('tools: {}');
    expect(mcpSource).toContain('resources: {}');
  });
});

// ═══════════════════════════════════════════════════
// Gateway Fallback Logic
// ═══════════════════════════════════════════════════

describe('MCP: Gateway fallback', () => {
  it('should try gateway first, fallback to Ollama', () => {
    expect(mcpSource).toContain('smartFetch');
    expect(mcpSource).toContain('gatewayFetch');
    expect(mcpSource).toContain('ollamaFetch');
  });

  it('should send Authorization header when API key is set', () => {
    expect(mcpSource).toContain('Authorization');
    expect(mcpSource).toContain('Bearer');
  });

  it('should use OpenAI format for gateway chat', () => {
    expect(mcpSource).toContain('/v1/chat/completions');
  });

  it('should use Ollama native format as fallback', () => {
    expect(mcpSource).toContain('/api/chat');
  });
});

// ═══════════════════════════════════════════════════
// README Documentation
// ═══════════════════════════════════════════════════

describe('MCP: Documentation', () => {
  const readme = fs.readFileSync(path.resolve('mcp/README.md'), 'utf8');

  it('should have Claude Desktop setup instructions', () => {
    expect(readme).toContain('claude_desktop_config.json');
  });

  it('should have Cursor setup instructions', () => {
    expect(readme).toContain('.cursor/mcp.json');
  });

  it('should have Claude Code setup instructions', () => {
    expect(readme).toContain('claude mcp add');
  });

  it('should list all environment variables', () => {
    expect(readme).toContain('OLLAMA_HOST');
    expect(readme).toContain('LLMBEAR_GATEWAY');
    expect(readme).toContain('LLMBEAR_API_KEY');
    expect(readme).toContain('LLMBEAR_MODEL');
  });

  it('should list all 7 tools', () => {
    expect(readme).toContain('chat');
    expect(readme).toContain('list_models');
    expect(readme).toContain('browse_catalog');
    expect(readme).toContain('pull_model');
    expect(readme).toContain('delete_model');
    expect(readme).toContain('model_info');
    expect(readme).toContain('system_info');
  });
});
