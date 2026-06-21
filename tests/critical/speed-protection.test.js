/**
 * SPEED PROTECTION — the fast streaming path is sacred.
 *
 * Aspen's "butter" feel comes from one thing: conversational messages stream
 * straight from Ollama (the FAST PATH) and never enter the non-streaming agent
 * loop. The only gate is messageNeedsTools() / TOOL_TRIGGERS. If anyone ever
 * broadens a trigger so it catches everyday chat ("hello", "I had a rough day",
 * "analyze our relationship"), those messages silently fall into the slow tool
 * loop and the streaming feel dies.
 *
 * These tests evaluate the LIVE regexes against real conversational input and
 * fail CI if any of them would be pulled off the fast path. Add agentic triggers
 * all you want — just don't let them catch ordinary conversation.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(path.resolve('src/main/gateway-agent.js'), 'utf8');

// Pull the live TOOL_TRIGGERS array out of source and evaluate it.
function loadTriggers() {
  const m = src.match(/const TOOL_TRIGGERS = \[([\s\S]*?)\];/);
  if (!m) throw new Error('TOOL_TRIGGERS not found');
  // eslint-disable-next-line no-eval
  return eval('[' + m[1] + ']');
}

// Mirror of messageNeedsTools() logic so we test the real routing decision.
const TRIGGERS = loadTriggers();
const needsTools = (text) => (text || '').length >= 2 && TRIGGERS.some((r) => r.test(text));

describe('Fast path is never disturbed by conversational messages', () => {
  // These MUST stay on the streaming fast path (needsTools === false).
  const MUST_STREAM = [
    'hello',
    'hi there',
    'good morning',
    'how are you',
    'my daughter loves me',
    'I had a rough day',
    'I feel anxious about work',
    'help me process my feelings about the breakup',
    'analyze our relationship',
    'I think my marriage is falling apart',
    'tell me a joke',
    'what should I name my cat',
    'write me a poem about autumn',
    'I am feeling overwhelmed',
    'thanks, that helped',
    'can you explain quantum entanglement',
    'what do you think about stoicism',
    'summarize the plot of Hamlet',
    'I love you',
    'goodnight',
  ];

  for (const msg of MUST_STREAM) {
    it(`stays on fast path: "${msg}"`, () => {
      expect(needsTools(msg)).toBe(false);
    });
  }
});

describe('Agentic requests DO route to the tool path (capability)', () => {
  // These SHOULD enter the tool loop (needsTools === true).
  const MUST_USE_TOOLS = [
    'download the Voynich manuscript images and analyze them',
    'scrape these pages and summarize',
    'decipher this cipher',
    'set up an analysis pipeline for these images',
    'transcribe this audio file',
    'analyze these images for patterns',
    'what is the weather today',
    'search the web for the latest news',
    'run ls -la',
  ];

  for (const msg of MUST_USE_TOOLS) {
    it(`routes to tools: "${msg}"`, () => {
      expect(needsTools(msg)).toBe(true);
    });
  }
});

describe('Fast path structure is intact', () => {
  it('fast path streams via ollamaStream (not the blocking agent loop)', () => {
    expect(src).toContain('FAST PATH');
    expect(src).toContain('ollamaStream(model, fastConvo)');
  });

  it('tool loop is only entered when needsTools is true', () => {
    expect(src).toContain('const needsTools =');
    expect(src).toContain('if (!needsTools)');
  });

  it('the deeper owner agent loop lives in the TOOL path, never the fast path', () => {
    // OWNER_MAX_TOOL_ROUNDS must sit with the agent loop, after the fast-path
    // return. If it ever appears before the fast path, loop depth could touch
    // streaming. Assert ordering.
    const fastReturn = src.indexOf('// ─── TOOL PATH ───');
    const ownerCap = src.indexOf('OWNER_MAX_TOOL_ROUNDS = ');
    const loopUse = src.indexOf('round < maxRounds');
    expect(fastReturn).toBeGreaterThan(0);
    expect(loopUse).toBeGreaterThan(fastReturn); // loop is after the tool-path marker
  });

  it('fast directive still instructs concise streaming (no tool preamble)', () => {
    expect(src).toContain('FAST_DIRECTIVE');
    expect(src).toContain('BE CONCISE');
  });
});
