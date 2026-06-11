import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp'), isPackaged: false },
  desktopCapturer: { getSources: vi.fn(async () => []) },
  screen: { getPrimaryDisplay: vi.fn(() => ({ workAreaSize: { width: 1280, height: 800 } })) },
}));
vi.mock('electron-store', () => ({
  default: class { constructor() { this._d={}; } get(k,d){return this._d[k]??d;} set(k,v){this._d[k]=v;} }
}));

const { getToolDefinitions, executeTool, ALL_TOOL_NAMES } = await import('../../src/main/tools.js');

describe('Tool Registration', () => {
  it('ALL_TOOL_NAMES is non-empty', () => {
    expect(Array.isArray(ALL_TOOL_NAMES)).toBe(true);
    expect(ALL_TOOL_NAMES.length).toBeGreaterThan(0);
  });

  it('includes core tools', () => {
    expect(ALL_TOOL_NAMES).toContain('web_search');
    expect(ALL_TOOL_NAMES).toContain('calculate');
    expect(ALL_TOOL_NAMES).toContain('get_datetime');
    expect(ALL_TOOL_NAMES).toContain('computer_use');
  });

  it('getToolDefinitions returns defs with name+description', () => {
    const defs = getToolDefinitions(ALL_TOOL_NAMES);
    expect(defs.length).toBeGreaterThan(0);
    for (const d of defs) {
      // Ollama format: {type, function: {name, description, parameters}}
      const fn = d.function || d;
      expect(fn).toHaveProperty('name');
      expect(fn).toHaveProperty('description');
    }
  });

  it('no duplicate tool names', () => {
    const defs = getToolDefinitions(ALL_TOOL_NAMES);
    const names = defs.map(d => (d.function || d).name);
    expect(names.length).toBe(new Set(names).size);
  });
});

describe('Tool Execution', () => {
  it('calculate works', async () => {
    const result = await executeTool('calculate', { expression: '2 + 2' });
    expect(String(result)).toContain('4');
  });

  it('get_datetime returns a string', async () => {
    const result = await executeTool('get_datetime', {});
    expect(String(result).length).toBeGreaterThan(5);
  });

  it('unknown tool returns error string, does not throw', async () => {
    let result;
    await expect(async () => { result = await executeTool('nonexistent_xyz', {}); }).not.toThrow();
    expect(result).toBeDefined();
  });
});

describe('Tool Security', () => {
  it('DANGEROUS_TOOLS includes run_command', () => {
    const src = fs.readFileSync(path.resolve('src/main/agent.js'), 'utf8');
    expect(src).toContain('DANGEROUS_TOOLS');
    const match = src.match(/DANGEROUS_TOOLS\s*=\s*\[([^\]]+)\]/);
    expect(match?.[1]).toContain('run_command');
  });

  it('dangerous tools filtered when not owner', () => {
    const src = fs.readFileSync(path.resolve('src/main/agent.js'), 'utf8');
    expect(src).toContain('isOwner');
    expect(src).toMatch(/filter[\s\S]{0,200}DANGEROUS_TOOLS|DANGEROUS_TOOLS[\s\S]{0,200}filter/);
  });
});

describe('Model Capability Detection', () => {
  it('getModelCapabilities uses /api/show', () => {
    const src = fs.readFileSync(path.resolve('src/main/ollama.js'), 'utf8');
    expect(src).toContain('/api/show');
    expect(src).toContain('capabilities');
    expect(src).toContain('getModelCapabilities');
  });

  it('falls back to name heuristics', () => {
    const src = fs.readFileSync(path.resolve('src/main/ollama.js'), 'utf8');
    expect(src).toContain('TOOL_MODELS');
    expect(src).toContain('VISION_MODELS');
  });
});
