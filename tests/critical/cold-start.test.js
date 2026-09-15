/**
 * Cold-start guards (2026-06-12).
 *
 * The model must stay resident so messages don't pay a cold-load penalty. Ollama
 * resets a model's idle timer to its 5-minute default on ANY request that omits
 * keep_alive — so a single chat path missing keep_alive:-1 silently brings cold
 * starts back. These guards assert every path that talks to Ollama for chat sets
 * keep_alive:-1, plus the two warm triggers (startup + model switch).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const read = (p) => fs.readFileSync(path.resolve(p), 'utf8');
const ollama = read('src/main/ollama.js');
const agent = read('src/main/agent.js');
const gatewayAgent = read('src/main/gateway-agent.js');
const gateway = read('src/main/gateway.js');
const index = read('src/main/index.js');

describe('Every chat path keeps the model resident (keep_alive:-1)', () => {
  it('desktop streaming path (ollama.js) sets keep_alive:-1', () => {
    // the /api/chat streaming body must carry keep_alive
    const chatBody = ollama.slice(ollama.indexOf('/api/chat'), ollama.indexOf('/api/chat') + 400);
    expect(ollama).toMatch(/stream:\s*true,\s*keep_alive:\s*-1/);
  });
  it('desktop agent path (agent.js) sets keep_alive:-1', () => {
    expect(agent).toContain("require('./gateway-agent')");
    expect(gatewayAgent).toMatch(/KEEP_ALIVE\s*=\s*-1/);
  });
  it('gateway-agent path uses KEEP_ALIVE = -1', () => {
    expect(gatewayAgent).toMatch(/KEEP_ALIVE\s*=\s*-1/);
  });
  it('gateway chat proxy defaults keep_alive to -1', () => {
    expect(gateway).toMatch(/keep_alive\s*=\s*-1/);
  });
});

describe('Warm triggers cover boot and model switch', () => {
  it('inference startup is owned by the runtime, not duplicated by the gateway', () => {
    expect(gateway).not.toMatch(/Warmed coder/);
    expect(fs.readFileSync(path.resolve('src/main/service.js'), 'utf8')).toContain('appliance-model');
  });
  it('ollama.js exports a reusable warmModel', () => {
    expect(ollama).toMatch(/function warmModel/);
    expect(ollama).toMatch(/warmModel,/); // in module.exports
  });
  it('switching models warms before committing the selection', () => {
    const app = read('src/renderer/App.jsx');
    expect(app).toMatch(/await warmActiveModel\(modelName\)/);
  });
});
