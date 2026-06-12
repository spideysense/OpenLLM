/**
 * Gateway reliability fixes (2026-06-12), from a real failure:
 *  - "good place to get coffee in burlingame" matched no TOOL_TRIGGER, so the
 *    gateway skipped search and the model invented a generic "how to find a
 *    shop" list. → broaden triggers to cover local/recommendation lookups.
 *  - "Ollama request timed out" on a reasoning model: the agent inference was
 *    NON-streaming, so the socket was idle while the model thought and the idle
 *    timeout fired mid-work. → stream the inference so the timeout only fires on
 *    a genuine stall.
 *  - A request with no `model` defaulted to a hardcoded 'llama3'. → fall back to
 *    the user's active model.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const gwAgent = fs.readFileSync(path.resolve('src/main/gateway-agent.js'), 'utf8');
const gw = fs.readFileSync(path.resolve('src/main/gateway.js'), 'utf8');

// Pull the live TOOL_TRIGGERS array out of source and evaluate it.
function loadTriggers() {
  const m = gwAgent.match(/const TOOL_TRIGGERS = \[([\s\S]*?)\];/);
  if (!m) throw new Error('TOOL_TRIGGERS not found');
  // eslint-disable-next-line no-eval
  const arr = eval('[' + m[1] + ']');
  return (t) => arr.some((r) => r.test(t));
}

describe('Tool triggers catch local & recommendation lookups', () => {
  const needs = loadTriggers();

  it.each([
    'good place to get coffee in burlingame that\u2019s not a chain',
    'best ramen near me',
    'where can I find a good dentist',
    'recommend a cheap hotel in tahoe',
    'places to eat downtown',
    'whats the weather today',
    'who is the ceo of openai',
  ])('searches for: %s', (q) => {
    expect(needs(q)).toBe(true);
  });

  it.each([
    'hello',
    'write me a poem about the ocean',
    'write me a haiku about rain',
    'i love the sound of rain',
    'explain how photosynthesis works',
    'thanks!',
    'can you help me debug this python function',
  ])('stays fast chat for: %s', (q) => {
    expect(needs(q)).toBe(false);
  });
});

describe('Agent inference streams so the idle timeout only fires on a real stall', () => {
  it('ollamaChat streams from /api/chat (stream:true), not a blocking call', () => {
    const fn = gwAgent.slice(gwAgent.indexOf('function ollamaChat'), gwAgent.indexOf('function ollamaChat') + 2600);
    expect(fn).toMatch(/stream:\s*true/);
    expect(fn).toMatch(/\/api\/chat/);
    expect(fn).toMatch(/tool_calls/);
  });
  it('resolves the normalized OpenAI message shape so callers are unchanged', () => {
    expect(gwAgent).toMatch(/choices:\s*\[\{\s*message:\s*\{\s*role:\s*'assistant'/);
  });
  it('uses a long cold-load grace for the first token, then a tighter idle timeout', () => {
    // A big model can take minutes to load before the first byte, so the initial
    // grace is long; once output flows it drops to a shorter stall timeout.
    expect(gwAgent).toMatch(/COLD_LOAD_MS\s*=\s*300000/);
    expect(gwAgent).toMatch(/IDLE_MS\s*=\s*120000/);
    // Both paths arm the cold grace first, then re-arm to IDLE_MS on first byte.
    expect(gwAgent).toMatch(/setTimeout\(COLD_LOAD_MS\)/);
    expect(gwAgent).toMatch(/setTimeout\(IDLE_MS\)/);
  });
  it('the timeout message tells the user to try a smaller model, not a generic timeout', () => {
    expect(gwAgent).toMatch(/smaller model/);
    expect(gwAgent).not.toMatch(/Ollama request timed out/);
    expect(gwAgent).not.toMatch(/no output for 180s/);
  });
});

describe('A request with no model falls back to the active model', () => {
  it('both gateway paths use store.get(activeModel) before the hardcoded default', () => {
    const matches = gw.match(/parsed\.model \|\| store\.get\('activeModel'\) \|\| 'llama3'/g) || [];
    expect(matches.length).toBe(2);
  });
});
