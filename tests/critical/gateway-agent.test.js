/**
 * Gateway Agent tests
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false } }));
vi.mock('electron-store', () => ({ default: class { get() {} set() {} } }));
vi.mock('child_process', () => ({ execSync: vi.fn(() => ''), execFileSync: vi.fn(() => '') }));
vi.mock('http', () => ({
  request: vi.fn(() => ({ write: vi.fn(), end: vi.fn(), on: vi.fn(), setTimeout: vi.fn(), destroy: vi.fn() })),
}));

const { run, SAFE_TOOLS, DANGEROUS_TOOLS, GATEWAY_COMPUTER_TOOL_DEFS } = await import('../../src/main/gateway-agent.js');

describe('Tool availability', () => {
  it('safe tools cover the basics', () => {
    for (const t of ['web_search', 'calculate', 'get_datetime', 'fetch_url', 'deep_research']) {
      expect(SAFE_TOOLS).toContain(t);
    }
  });
  it('dangerous tools include run_command and all computer_* tools', () => {
    for (const t of ['run_command', 'computer_screenshot', 'computer_click', 'computer_type', 'computer_key', 'computer_scroll']) {
      expect(DANGEROUS_TOOLS).toContain(t);
    }
  });
  it('safe and dangerous sets are disjoint', () => {
    expect(SAFE_TOOLS.filter(t => DANGEROUS_TOOLS.includes(t))).toHaveLength(0);
  });
});

describe('Computer tool definitions — OpenAI format for Ollama', () => {
  it('all 5 computer tools present', () => {
    const names = GATEWAY_COMPUTER_TOOL_DEFS.map(d => d.function.name);
    for (const n of ['computer_screenshot', 'computer_click', 'computer_type', 'computer_key', 'computer_scroll']) {
      expect(names).toContain(n);
    }
  });
  it('each def uses type+function.name+function.parameters (OpenAI format)', () => {
    for (const def of GATEWAY_COMPUTER_TOOL_DEFS) {
      expect(def.type).toBe('function');
      expect(def.function.name).toBeTruthy();
      expect(def.function.parameters).toBeDefined();
      expect(def.function.parameters.type).toBe('object');
      expect(def.input_schema).toBeUndefined(); // must NOT be Anthropic format
    }
  });
  it('computer_click requires x and y', () => {
    const click = GATEWAY_COMPUTER_TOOL_DEFS.find(d => d.function.name === 'computer_click');
    expect(click.function.parameters.required).toContain('x');
    expect(click.function.parameters.required).toContain('y');
  });
});

describe('Agent event contract', () => {
  it('yields error for null messages', async () => {
    const events = [];
    for await (const e of run({ model: 'llama3', messages: null, isOwner: false })) events.push(e);
    expect(events[0].type).toBe('error');
  });
  it('yields error for empty messages array', async () => {
    const events = [];
    for await (const e of run({ model: 'llama3', messages: [], isOwner: false })) events.push(e);
    expect(events[0].type).toBe('error');
  });
  it('yields error for missing model', async () => {
    const events = [];
    for await (const e of run({ model: '', messages: [{ role: 'user', content: 'hi' }], isOwner: false })) events.push(e);
    expect(events[0].type).toBe('error');
  });
  it('a tool-triggering message yields status first (agent path)', async () => {
    // "what is the weather" matches a tool trigger → agent path → status first
    const gen = run({ model: 'llama3', messages: [{ role: 'user', content: 'what is the weather today' }], isOwner: false });
    const first = await gen.next();
    expect(first.value.type).toBe('status');
  });
});

describe('Security', () => {
  it('no top-level require("electron") in gateway-agent', () => {
    const src = fs.readFileSync(path.resolve('src/main/gateway-agent.js'), 'utf8');
    expect(src).not.toMatch(/^const.*require\(['"]electron['"]\)/m);
  });
  it('non-owner blocked from dangerous tools in code', () => {
    const src = fs.readFileSync(path.resolve('src/main/gateway-agent.js'), 'utf8');
    expect(src).toContain('DANGEROUS_TOOLS.includes(name) && !isOwner');
    expect(src).toContain('owner access');
  });
  it('isOwner passed from gateway to agent', () => {
    const src = fs.readFileSync(path.resolve('src/main/gateway.js'), 'utf8');
    expect(src).toContain('isOwnerKey(authToken)');
    expect(src).toContain('isOwner');
  });
});

describe('Screenshot uses CLI not Electron', () => {
  it('uses screencapture on Mac', () => {
    const src = fs.readFileSync(path.resolve('src/main/gateway-agent.js'), 'utf8');
    expect(src).toContain('screencapture');
  });
  it('has Windows and Linux fallbacks', () => {
    const src = fs.readFileSync(path.resolve('src/main/gateway-agent.js'), 'utf8');
    expect(src).toContain('CopyFromScreen');
    expect(src).toContain('scrot');
  });
  it('cleans up temp file in finally block', () => {
    const src = fs.readFileSync(path.resolve('src/main/gateway-agent.js'), 'utf8');
    expect(src).toContain('unlinkSync');
    expect(src).toContain('finally');
  });
  it('does NOT use desktopCapturer', () => {
    const src = fs.readFileSync(path.resolve('src/main/gateway-agent.js'), 'utf8');
    expect(src).not.toContain('desktopCapturer');
  });
});

describe('api/agent.js Vercel endpoint', () => {
  it('file exists', () => { expect(fs.existsSync(path.resolve('api/agent.js'))).toBe(true); });
  it('routes to /v1/agent not /v1/chat/completions', () => {
    const src = fs.readFileSync(path.resolve('api/agent.js'), 'utf8');
    expect(src).toContain('/v1/agent');
    expect(src).not.toContain('/v1/chat/completions');
  });
  it('validates tunnel URL domain', () => {
    const src = fs.readFileSync(path.resolve('api/agent.js'), 'utf8');
    expect(src).toContain('runonaspen.com');
    expect(src).toContain('403');
  });
  it('sends keep-alive heartbeat', () => {
    const src = fs.readFileSync(path.resolve('api/agent.js'), 'utf8');
    expect(src).toContain('keep-alive');
    expect(src).toContain('8000');
  });
  it('uses edge runtime', () => {
    const src = fs.readFileSync(path.resolve('api/agent.js'), 'utf8');
    expect(src).toContain("runtime: 'edge'");
  });
});

describe('Gateway /v1/agent route', () => {
  it('gateway.js imports gateway-agent', () => {
    const src = fs.readFileSync(path.resolve('src/main/gateway.js'), 'utf8');
    expect(src).toContain('gateway-agent');
  });
  it('route handles POST /v1/agent', () => {
    const src = fs.readFileSync(path.resolve('src/main/gateway.js'), 'utf8');
    expect(src).toContain("'/v1/agent'");
    expect(src).toContain("'POST'");
  });
  it('sends SSE headers with X-Accel-Buffering', () => {
    const src = fs.readFileSync(path.resolve('src/main/gateway.js'), 'utf8');
    expect(src).toContain('text/event-stream');
    expect(src).toContain('X-Accel-Buffering');
  });
  it('heartbeat prevents timeout during long tool chains', () => {
    const src = fs.readFileSync(path.resolve('src/main/gateway.js'), 'utf8');
    expect(src).toContain('keep-alive');
    expect(src).toContain('8000');
  });
  it('validates messages array before calling agent', () => {
    const src = fs.readFileSync(path.resolve('src/main/gateway.js'), 'utf8');
    expect(src).toContain('Array.isArray(agentMsgs)');
    expect(src).toContain('400');
  });
});

describe('Web and mobile apps use /api/agent', () => {
  it('web app main chat uses /api/agent', () => {
    expect(fs.readFileSync(path.resolve('site/app/index.html'), 'utf8')).toContain("'/api/agent'");
  });
  it('mobile app main chat uses /api/agent', () => {
    expect(fs.readFileSync(path.resolve('mobile/www/index.html'), 'utf8')).toContain("'/api/agent'");
  });
  it('web app renders tool status', () => {
    const src = fs.readFileSync(path.resolve('site/app/index.html'), 'utf8');
    expect(src).toContain('aspen_status');
    expect(src).toContain('agent-steps');
  });
  it('mobile app renders tool status', () => {
    const src = fs.readFileSync(path.resolve('mobile/www/index.html'), 'utf8');
    expect(src).toContain('aspen_status');
    expect(src).toContain('agent-steps');
  });
});

describe('Screenshot vision handling', () => {
  it('screenshot result is fed as image, not base64 text', () => {
    const src = fs.readFileSync(path.resolve('src/main/gateway-agent.js'), 'utf8');
    // Must detect screenshot results and push them as images[], not text content
    expect(src).toContain('isScreenshot');
    expect(src).toContain('images:');
    expect(src).toContain("data:image");
  });

  it('strips data: prefix before sending to Ollama images array', () => {
    const src = fs.readFileSync(path.resolve('src/main/gateway-agent.js'), 'utf8');
    expect(src).toMatch(/replace\(\/\^data:image/);
  });

  it('ollamaChat switches to native /api/chat when images present', () => {
    const src = fs.readFileSync(path.resolve('src/main/gateway-agent.js'), 'utf8');
    expect(src).toContain('hasImages');
    expect(src).toContain('/api/chat');
    expect(src).toContain('useNative');
  });

  it('normalizes native response back to OpenAI shape', () => {
    const src = fs.readFileSync(path.resolve('src/main/gateway-agent.js'), 'utf8');
    expect(src).toContain('choices: [{');
    expect(src).toContain('data.message?.content');
  });
});

describe('Reasoning trail in web/mobile apps', () => {
  it('web app accumulates steps into a trail', () => {
    const src = fs.readFileSync(path.resolve('site/app/index.html'), 'utf8');
    expect(src).toContain('renderStepsHTML');
    expect(src).toContain('bubble._steps');
    expect(src).toContain('agent-steps');
  });
  it('mobile app accumulates steps into a trail', () => {
    const src = fs.readFileSync(path.resolve('mobile/www/index.html'), 'utf8');
    expect(src).toContain('renderStepsHTML');
    expect(src).toContain('bubble._steps');
    expect(src).toContain('agent-steps');
  });
  it('steps collapse above the answer once content streams', () => {
    const src = fs.readFileSync(path.resolve('site/app/index.html'), 'utf8');
    expect(src).toContain('renderStepsHTML(bubble._steps,false)');
  });
  it('gateway forwards status and tool_call as aspen_status', () => {
    const src = fs.readFileSync(path.resolve('src/main/gateway.js'), 'utf8');
    expect(src).toContain('aspen_status: event.text');
    expect(src).toContain('aspen_status: event.statusText');
  });
});
