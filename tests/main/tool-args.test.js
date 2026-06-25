// Regression guard for the tool-argument parsing bug that broke web search twice.
//
// Ollama's native /api/chat returns tool-call arguments as a JS OBJECT ({query:'x'}).
// The old code did JSON.parse(arguments), which throws on an object ('[object Object]'),
// swallowed the throw, and dropped every argument -> web_search('No query provided').
// It bit us in TWO separate agents (gateway-agent.js for desktop, agent.js for remote).
//
// These tests pin BOTH parsers to the correct behavior, AND scan the source so the raw
// JSON.parse(...arguments...) anti-pattern can never be reintroduced anywhere in main/.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseToolArgs } from '../../src/main/tool-args.js';

const MAIN_DIR = join(process.cwd(), 'src', 'main');

describe('parseToolArgs (shared by both agents)', () => {
  const parse = parseToolArgs;
  it('preserves Ollama native OBJECT-form args (the bug)', () => {
    expect(parse({ query: 'weather in Hillsborough' })).toEqual({ query: 'weather in Hillsborough' });
  });
  it('parses OpenAI STRING-form args', () => {
    expect(parse('{"query":"weather"}')).toEqual({ query: 'weather' });
  });
  it('returns {} for empty / missing / malformed', () => {
    expect(parse(undefined)).toEqual({});
    expect(parse(null)).toEqual({});
    expect(parse('')).toEqual({});
    expect(parse('   ')).toEqual({});
    expect(parse('{not json}')).toEqual({});
  });
  it('never throws on any input', () => {
    for (const v of [undefined, null, 0, false, [], {}, 'x', '{}', '[object Object]']) {
      expect(() => parse(v)).not.toThrow();
    }
  });
  it('a real tool call keeps its query end-to-end (would have returned {} before)', () => {
    const ollamaToolCall = { function: { name: 'web_search', arguments: { query: 'barcelona weather' } } };
    expect(parse(ollamaToolCall.function.arguments).query).toBe('barcelona weather');
  });
});

describe('source guard: no raw JSON.parse of tool arguments anywhere in src/main', () => {
  it('every .js file uses parseToolArgs, never JSON.parse(...arguments...)', () => {
    const offenders = [];
    for (const f of readdirSync(MAIN_DIR).filter((f) => f.endsWith('.js'))) {
      const src = readFileSync(join(MAIN_DIR, f), 'utf8');
      src.split('\n').forEach((line, i) => {
        // The exact anti-pattern: JSON.parse(...) on the same line as `arguments`.
        if (/JSON\.parse\([^)]*arguments/.test(line)) offenders.push(`${f}:${i + 1}  ${line.trim()}`);
      });
    }
    expect(offenders, `Use parseToolArgs() instead of JSON.parse on tool arguments:\n${offenders.join('\n')}`).toEqual([]);
  });
});
