import { describe, it, expect } from 'vitest';
import {
  mlxModelFor, serverArgs, toOpenAIChatBody, parseOpenAISSELine, MLX_MODEL_MAP, PORT,
} from '../../src/main/mlx.js';

describe('mlxModelFor', () => {
  it('maps known Ollama tags to mlx-community repos', () => {
    expect(mlxModelFor('qwen3:32b')).toBe('mlx-community/Qwen3-32B-4bit');
    expect(mlxModelFor('llama3.2:3b')).toBe('mlx-community/Llama-3.2-3B-Instruct-4bit');
  });
  it('is case-insensitive', () => {
    expect(mlxModelFor('QWEN3:32B')).toBe(MLX_MODEL_MAP['qwen3:32b']);
  });
  it('returns null for unknown models so the caller stays on Ollama', () => {
    expect(mlxModelFor('qwen3.6:35b-a3b')).toBeNull(); // no published MLX build mapped
    expect(mlxModelFor('some-random-model')).toBeNull();
    expect(mlxModelFor('')).toBeNull();
    expect(mlxModelFor(undefined)).toBeNull();
  });
});

describe('serverArgs', () => {
  it('builds the mlx_lm.server argv with model/host/port', () => {
    expect(serverArgs('mlx-community/Qwen3-32B-4bit')).toEqual(
      ['-m', 'mlx_lm.server', '--model', 'mlx-community/Qwen3-32B-4bit', '--host', '127.0.0.1', '--port', String(PORT)]
    );
  });
});

describe('toOpenAIChatBody', () => {
  const msgs = [{ role: 'user', content: 'hi' }];
  it('translates num_predict to max_tokens and drops Ollama-only options', () => {
    const body = toOpenAIChatBody('m', msgs, { options: { num_predict: 256, num_ctx: 16384, keep_alive: -1, think: false } });
    expect(body.max_tokens).toBe(256);
    expect(body).not.toHaveProperty('keep_alive');
    expect(body).not.toHaveProperty('think');
    expect(body).not.toHaveProperty('num_ctx');
    expect(body.stream).toBe(true);
  });
  it('omits max_tokens when num_predict is -1 (unbounded)', () => {
    const body = toOpenAIChatBody('m', msgs, { options: { num_predict: -1 } });
    expect(body).not.toHaveProperty('max_tokens');
  });
  it('carries tools through in OpenAI schema', () => {
    const tools = [{ type: 'function', function: { name: 'web_search' } }];
    expect(toOpenAIChatBody('m', msgs, { tools }).tools).toEqual(tools);
  });
});

describe('parseOpenAISSELine', () => {
  it('extracts content deltas', () => {
    expect(parseOpenAISSELine('data: {"choices":[{"delta":{"content":"hello"}}]}'))
      .toEqual({ kind: 'content', text: 'hello' });
  });
  it('extracts tool_call deltas', () => {
    const calls = [{ function: { name: 'web_search', arguments: '{"query":"weather"}' } }];
    expect(parseOpenAISSELine(`data: {"choices":[{"delta":{"tool_calls":${JSON.stringify(calls)}}}]}`))
      .toEqual({ kind: 'tools', calls });
  });
  it('returns done on [DONE]', () => {
    expect(parseOpenAISSELine('data: [DONE]')).toEqual({ kind: 'done' });
  });
  it('ignores non-data lines, empty deltas, and malformed JSON', () => {
    expect(parseOpenAISSELine(': keep-alive comment')).toBeNull();
    expect(parseOpenAISSELine('')).toBeNull();
    expect(parseOpenAISSELine('data: {"choices":[{"delta":{}}]}')).toBeNull();
    expect(parseOpenAISSELine('data: {not json}')).toBeNull();
  });
});
