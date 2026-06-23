/**
 * SPEED PROTECTION — the streaming feel is sacred.
 *
 * Aspen's "butter" comes from one thing: every turn STREAMS. Conversational
 * messages stream an answer instantly; tool turns fire an instant status and
 * narrate live, then stream the result. There is no longer a regex router
 * deciding fast-vs-slow — tools are always attached and the MODEL decides
 * whether to call one. The conversational-vs-tool judgment is verified live on
 * the box by scripts/probe-tool-judgment.sh (qwen3.6 answers "I had a rough
 * day" directly and only calls a tool for genuine action).
 *
 * These tests guard two things: (1) the streaming architecture stays intact and
 * nothing collapses back into a blocking non-streaming round-trip, and (2) the
 * directives keep instructing the model not to code on casual/emotional input.
 * The legacy TOOL_TRIGGERS regex is retained as a reference contract and still
 * checked here, but it no longer gates routing.
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

describe('Streaming architecture is intact (the butter)', () => {
  it('no-tools models stream via ollamaStream, never a blocking round-trip', () => {
    expect(src).toContain('NO-TOOLS FAST PATH');
    expect(src).toContain('ollamaStream(model, fastConvo)');
  });

  it('tool-capable turns stream via ollamaStreamTools (tools attached, model decides)', () => {
    // The unified path must STREAM with tools attached, not buffer a
    // non-streaming agent round-trip. ollamaStreamTools is the streaming call.
    expect(src).toContain('UNIFIED STREAMING + TOOLS PATH');
    expect(src).toContain('ollamaStreamTools(model, convo, toolDefs)');
  });

  it('the answer streams incrementally, never buffered', () => {
    // Content deltas are yielded as they arrive inside the loop. If this ever
    // collapses into a single post-loop content yield, streaming is dead.
    expect(src).toContain("yield { type: 'content', text: ev.text }");
  });

  it('a slow first token shows instant honest status, never a frozen wait', () => {
    expect(src).toContain('SLOW_FIRST_TOKEN');
    expect(src).toContain('FIRST_TOKEN_NUDGE_MS');
  });

  it('tool turns fire an instant status + live tool narration', () => {
    expect(src).toContain('Using tools to do this');
    expect(src).toContain("type: 'tool_call'");
  });

  it('the owner tool loop is bounded', () => {
    expect(src).toContain('OWNER_MAX_TOOL_ROUNDS');
    expect(src).toContain('round < maxRounds');
  });

  it('directives forbid code on conversational/emotional messages (model-judgment guard)', () => {
    // Conversational-vs-tool routing is now the MODEL's call, verified live by
    // scripts/probe-tool-judgment.sh on the box. The directives must keep
    // telling the model not to code on casual/emotional input so the butter
    // survives even though no regex gates it anymore.
    expect(src).toContain('I had a rough day');
    expect(src).toContain('analyze our relationship');
  });

  it('fast directive still instructs concise streaming', () => {
    expect(src).toContain('FAST_DIRECTIVE');
    expect(src).toContain('BE CONCISE');
  });
});
