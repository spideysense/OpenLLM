import { describe, it, expect } from 'vitest';
import router from '../../src/main/model-router.js';

const { decideChatModel, decideCodingModel, isCoderName } = router;

const LIST = [
  { name: 'llama4:scout', size: 68e9 },
  { name: 'qwen2.5-coder:32b', size: 28e9 },
  { name: 'nomic-embed-text', size: 3e8 },
  { name: 'llama3.2:3b', size: 2e9 },
];

// The phone bug: a client sends qwen2.5-coder as the model and asks a plain
// question ("Is the vegetarian Omega 3?"). routeModel must DOWNGRADE to the chat
// model instead of answering chat with the coder.
describe('decideChatModel (coder -> chat downgrade)', () => {
  it('downgrades a requested coder to the largest non-coder on a chat turn', () => {
    expect(decideChatModel({ requested: 'qwen2.5-coder:32b', list: LIST })).toBe('llama4:scout');
  });

  it('leaves a chat model untouched', () => {
    expect(decideChatModel({ requested: 'llama4:scout', list: LIST })).toBe('llama4:scout');
  });

  it('keeps the coder if no non-coder is installed (can not downgrade)', () => {
    expect(decideChatModel({ requested: 'qwen2.5-coder:32b', list: [{ name: 'qwen2.5-coder:32b', size: 28e9 }] }))
      .toBe('qwen2.5-coder:32b');
  });

  it('never downgrades to an embedding model', () => {
    const list = [{ name: 'nomic-embed-text', size: 3e8 }, { name: 'qwen2.5-coder:32b', size: 28e9 }, { name: 'llama3.2:3b', size: 2e9 }];
    expect(decideChatModel({ requested: 'qwen2.5-coder:32b', list })).toBe('llama3.2:3b');
  });
});

// The upgrade path must still work: a chat model on a real coding turn routes to
// the coder when it co-fits.
describe('decideCodingModel (chat -> coder upgrade preserved)', () => {
  it('keeps an existing coder on a coding turn', () => {
    expect(decideCodingModel({ requested: 'qwen2.5-coder:32b', text: 'write a python function', list: LIST, ramBytes: 128e9, ctx: 16384 }))
      .toBe('qwen2.5-coder:32b');
  });

  it('upgrades chat -> coder on a coding turn when the pair co-fits', () => {
    expect(decideCodingModel({ requested: 'llama4:scout', text: 'refactor this React component', list: LIST, ramBytes: 128e9, ctx: 16384 }))
      .toBe('qwen2.5-coder:32b');
  });

  it('stays on chat for a non-coding turn', () => {
    expect(decideCodingModel({ requested: 'llama4:scout', text: 'is the vegetarian omega 3?', list: LIST, ramBytes: 128e9, ctx: 16384 }))
      .toBe('llama4:scout');
  });

  it('does not force a coder swap when the pair would not fit in RAM', () => {
    // 8GB box can't hold scout+coder; keep the requested model.
    expect(decideCodingModel({ requested: 'llama4:scout', text: 'write code', list: LIST, ramBytes: 8e9, ctx: 16384 }))
      .toBe('llama4:scout');
  });
});

describe('isCoderName', () => {
  it('recognizes coder tags', () => {
    expect(isCoderName('qwen2.5-coder:32b')).toBe(true);
    expect(isCoderName('deepseek-coder:6.7b')).toBe(true);
    expect(isCoderName('llama4:scout')).toBe(false);
  });
});
