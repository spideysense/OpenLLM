import { describe, it, expect, beforeEach } from 'vitest';
import {
  isGpuRuntimeFailure,
  isGpuOom,
  forceCpu,
  setForceCpu,
  resetForceCpu,
  gpuOptions,
  withGpuFallback,
  GPU_FALLBACK_MESSAGE,
} from '../../src/main/gpu-fallback.js';

beforeEach(() => resetForceCpu());

describe('isGpuRuntimeFailure', () => {
  it("matches the field repro (Rishi's Windows NVIDIA crash)", () => {
    const real =
      'Error: 500 Internal Server Error: llama-server process has terminated: ' +
      'exit status 0xc0000409: The system detected an overrun of a stack-based ' +
      'buffer in this application... : CUDA error\nCUDA error: device kernel image is invalid';
    expect(isGpuRuntimeFailure(real)).toBe(true);
  });

  it('matches the individual GPU crash signatures', () => {
    for (const s of [
      'CUDA error: device kernel image is invalid',
      'no kernel image is available for execution on the device',
      'exit status 0xc0000409',
      'llama-server process has terminated',
      'ggml_cuda_compute_forward failed',
      'cuBLAS error',
      'cudnn status not initialized',
    ]) {
      expect(isGpuRuntimeFailure(s)).toBe(true);
    }
  });

  it('treats out-of-memory as a sizing problem, NOT a dead GPU', () => {
    // OOM means "this model is too big", not "this card is broken". It must not flip
    // the permanent CPU flag, or one oversized model poisons every smaller one after it.
    for (const s of [
      'CUDA out of memory',
      'cuBLAS error: out of memory trying to allocate',
      'GPU out of memory',
    ]) {
      expect(isGpuRuntimeFailure(s)).toBe(false);
      expect(isGpuOom(s)).toBe(true);
    }
  });

  it('accepts an Error object, not just a string', () => {
    expect(isGpuRuntimeFailure(new Error('CUDA error: device kernel image is invalid'))).toBe(true);
  });

  it('does NOT match ordinary, non-GPU errors', () => {
    for (const s of [
      'model "llama4:scout" not found, try pulling it first',
      '404 page not found',
      'Unexpected token < in JSON at position 0',
      'request timed out',
      'ECONNREFUSED 127.0.0.1:11434',
      '',
      null,
      undefined,
    ]) {
      expect(isGpuRuntimeFailure(s)).toBe(false);
    }
  });
});

describe('force-CPU flag + gpuOptions', () => {
  it('defaults to GPU (empty options) and flips to num_gpu:0 when forced', () => {
    expect(forceCpu()).toBe(false);
    expect(gpuOptions()).toEqual({});
    setForceCpu(true);
    expect(forceCpu()).toBe(true);
    expect(gpuOptions()).toEqual({ num_gpu: 0 });
  });
});

describe('withGpuFallback', () => {
  it('returns the result and never flips CPU when the GPU attempt succeeds', async () => {
    const seen = [];
    const out = await withGpuFallback(async (opts) => { seen.push(opts); return 'ok'; });
    expect(out).toBe('ok');
    expect(forceCpu()).toBe(false);
    expect(seen).toEqual([{}]); // ran once, on the GPU
  });

  it('flips to CPU and retries once with num_gpu:0 on a GPU crash, returning the retry', async () => {
    const seen = [];
    let n = 0;
    const out = await withGpuFallback(async (opts) => {
      seen.push(opts);
      if (n++ === 0) throw new Error('CUDA error: device kernel image is invalid');
      return 'cpu-answer';
    });
    expect(out).toBe('cpu-answer');
    expect(forceCpu()).toBe(true);
    expect(seen).toEqual([{}, { num_gpu: 0 }]); // GPU first, then CPU
  });

  it('propagates a non-GPU error unchanged, with no retry and no flip', async () => {
    let calls = 0;
    await expect(
      withGpuFallback(async () => { calls++; throw new Error('model not found'); })
    ).rejects.toThrow('model not found');
    expect(calls).toBe(1);
    expect(forceCpu()).toBe(false);
  });

  it('does not loop: when already in CPU mode, a further GPU crash throws (no second retry)', async () => {
    setForceCpu(true);
    let calls = 0;
    await expect(
      withGpuFallback(async () => { calls++; throw new Error('CUDA error: device kernel image is invalid'); })
    ).rejects.toThrow(/CUDA/);
    expect(calls).toBe(1); // attempted once on CPU; no infinite GPU<->CPU retry
  });

  it('on OOM, runs THIS call on CPU but does NOT flip the session — the next smaller model still gets the GPU', async () => {
    // The regression behind the field report: big model OOMs, then every smaller model
    // is slow too. Here the oversized model falls back to CPU for its own call, but the
    // flag stays false so the next model is tried on the GPU again.
    const big = [];
    const bigOut = await withGpuFallback(async (opts) => {
      big.push(opts);
      if (big.length === 1) throw new Error('CUDA out of memory: tried to allocate 18.2 GiB');
      return 'cpu-answer-for-big-model';
    });
    expect(bigOut).toBe('cpu-answer-for-big-model');
    expect(big).toEqual([{}, { num_gpu: 0 }]); // GPU attempt, then CPU retry for THIS call
    expect(forceCpu()).toBe(false);            // crucially: session NOT demoted

    // Now a smaller model: it should get a clean GPU attempt, not be forced to CPU.
    const small = [];
    const smallOut = await withGpuFallback(async (opts) => { small.push(opts); return 'fast-gpu-answer'; });
    expect(smallOut).toBe('fast-gpu-answer');
    expect(small).toEqual([{}]); // ran on the GPU, fast
  });
});

describe('user-facing message', () => {
  it('is human-readable and leaks no raw CUDA / stack-overflow string', () => {
    expect(GPU_FALLBACK_MESSAGE.toLowerCase()).toContain('cpu mode');
    expect(GPU_FALLBACK_MESSAGE.toLowerCase()).not.toContain('cuda');
    expect(GPU_FALLBACK_MESSAGE).not.toContain('0xc0000409');
  });
});
