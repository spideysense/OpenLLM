/**
 * Capability tiering (2026-06-12).
 *
 * The policy in capabilities.js decides what a model+machine combo can do, so
 * the app degrades gracefully (a 4B model = fast chat, no failed tool loops)
 * instead of offering features that don't work or are too slow. These tests pin
 * the policy (the pure brain) and assert it's wired into both agent paths + the
 * UI plumbing.
 *
 * capabilities.js is Electron-free (system.js + global fetch), so computeProfile
 * and parseSizeB import and run directly here.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import * as cap from '../../src/main/capabilities.js';

describe('parseSizeB', () => {
  it('reads parameter_size strings', () => {
    expect(cap.parseSizeB('32.8B')).toBeCloseTo(32.8);
    expect(cap.parseSizeB('7B')).toBe(7);
    expect(cap.parseSizeB('46.7B')).toBeCloseTo(46.7);
  });
  it('falls back to the model tag', () => {
    expect(cap.parseSizeB(null, 'llama3.2:3b')).toBe(3);
    expect(cap.parseSizeB(null, 'qwen3:32b')).toBe(32);
    expect(cap.parseSizeB(null, 'gemma:2b')).toBe(2);
  });
  it('returns null when size is unknowable', () => {
    expect(cap.parseSizeB(null, 'mistral')).toBeNull();
  });
});

describe('computeProfile — tiers', () => {
  const P = (caps, hw = 'medium') => cap.computeProfile(caps, hw);

  it('4B and below = chat only, even if it reports tool support', () => {
    for (const sizeB of [1, 2, 3, 4]) {
      const p = P({ tools: true, vision: false, sizeB });
      expect(p.tier).toBe('chat');
      expect(p.allowedTools).toEqual([]);
      expect(p.features.webSearch).toBe(false);
    }
  });

  it('a non-tool model is chat regardless of size', () => {
    const p = P({ tools: false, vision: false, sizeB: 32 });
    expect(p.tier).toBe('chat');
    expect(p.allowedTools).toEqual([]);
  });

  it('5–13B with tools = standard (basic tools, no research/computer)', () => {
    const p = P({ tools: true, vision: false, sizeB: 8 });
    expect(p.tier).toBe('standard');
    expect(p.features.webSearch).toBe(true);
    expect(p.features.deepResearch).toBe(false);
    expect(p.features.computerUse).toBe(false);
    expect(p.allowedTools).toEqual(expect.arrayContaining(['web_search', 'calculate']));
    expect(p.allowedTools).not.toContain('deep_research');
  });

  it('14B+ with tools = full (research enabled)', () => {
    const p = P({ tools: true, vision: false, sizeB: 32 });
    expect(p.tier).toBe('full');
    expect(p.features.deepResearch).toBe(true);
    expect(p.allowedTools).toContain('deep_research');
  });

  it('a large vision model unlocks computer use', () => {
    const p = P({ tools: true, vision: true, sizeB: 26 });
    expect(p.features.computerUse).toBe(true);
    expect(p.allowedTools).toContain('computer_use');
  });

  it('light hardware disables the heavy multi-inference features', () => {
    const p = P({ tools: true, vision: true, sizeB: 26 }, 'light');
    expect(p.tier).toBe('full');           // model is still capable
    expect(p.features.deepResearch).toBe(false);
    expect(p.features.computerUse).toBe(false);
    expect(p.reasons.computerUse).toMatch(/machine/);
  });

  it('unknown size degrades gracefully to standard (not locked out)', () => {
    const p = P({ tools: true, vision: false, sizeB: null });
    expect(p.tier).toBe('standard');
  });

  it('always allows chat', () => {
    expect(P({ tools: false, sizeB: 1 }).features.chat).toBe(true);
  });
});

describe('capability gating is wired into both agent paths', () => {
  const agent = fs.readFileSync(path.resolve('src/main/agent.js'), 'utf8');
  const gw = fs.readFileSync(path.resolve('src/main/gateway-agent.js'), 'utf8');
  const index = fs.readFileSync(path.resolve('src/main/index.js'), 'utf8');
  const preload = fs.readFileSync(path.resolve('src/preload/index.js'), 'utf8');

  it('desktop agent filters enabled tools by allowedTools', () => {
    expect(agent).toMatch(/getProfile\(model\)/);
    expect(agent).toMatch(/allowedTools\.includes/);
  });
  it('gateway agent forces the fast path for chat-tier and filters tool defs', () => {
    expect(gw).toMatch(/getProfile\(model\)/);
    expect(gw).toMatch(/chatTier/);
    expect(gw).toMatch(/getToolDefs\(isOwner, allowedTools\)/);
  });
  it('profile is exposed via IPC + preload', () => {
    expect(index).toMatch(/'model:getProfile'/);
    expect(preload).toMatch(/getModelProfile/);
  });
  it('capability cache is cleared on model pull + delete', () => {
    expect(index).toMatch(/clearCache/);
  });
});
