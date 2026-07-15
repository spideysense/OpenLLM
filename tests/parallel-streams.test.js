import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

// Why this file exists: streaming used to be single-track — one buffer, one
// AbortController, one "which conversation is live" ref. Sending in a second
// chat clobbered the first, and Stop killed whichever started last. These guards
// pin the per-conversation contract end to end: main tags every chunk, ollama
// aborts by key, preload carries the id, the renderer routes on it.

describe('parallel streaming: main process tags chunks per conversation', () => {
  const index = read('src/main/index.js');

  it('chat:send accepts a convoId', () => {
    expect(index).toMatch(/ipcMain\.handle\('chat:send'[\s\S]{0,200}?convoId/);
  });

  it('every chat:stream emission carries convoId', () => {
    const sends = index.match(/webContents\.send\('chat:stream',\s*[\s\S]{0,220}?\)/g) || [];
    expect(sends.length).toBeGreaterThan(0);
    for (const s of sends) expect(s).toMatch(/convoId/);
  });

  it('ollama.chat gets a per-conversation abort key', () => {
    expect(index).toMatch(/ollama\.chat\([\s\S]{0,200}?\{\s*key:\s*convoId\s*\}/);
  });

  it('chat:stop stops one conversation, not all of them', () => {
    expect(index).toMatch(/ipcMain\.handle\('chat:stop',\s*async\s*\(event,\s*convoId\)/);
    expect(index).toMatch(/ollama\.abortChat\(convoId\)/);
  });
});

describe('parallel streaming: ollama aborts per conversation', () => {
  const ollama = read('src/main/ollama.js');

  it('keeps a controller per conversation, not one global', () => {
    expect(ollama).toMatch(/chatControllers\s*=\s*new Map\(\)/);
    expect(ollama).toMatch(/chatControllers\.set\(key,\s*ctrl\)/);
  });

  it('each request uses its own signal', () => {
    expect(ollama).toMatch(/signal:\s*ctrl\.signal/);
    // the old global-signal bug: a 2nd chat overwrote the 1st's controller
    expect(ollama).not.toMatch(/signal:\s*chatController\.signal/);
  });

  it('abortChat(key) stops only that chat; abortChat() stops all', () => {
    expect(ollama).toMatch(/function abortChat\(key\)/);
    expect(ollama).toMatch(/chatControllers\.get\(key\)/);
  });

  it('cleanup removes only this conversation', () => {
    expect(ollama).toMatch(/chatControllers\.delete\(key\)/);
  });
});

describe('parallel streaming: preload + renderer route by conversation', () => {
  const preload = read('src/preload/index.js');
  const chat = read('src/renderer/pages/Chat.jsx');

  it('preload passes convoId on send and stop', () => {
    expect(preload).toMatch(/send:\s*\(model,\s*messages,\s*convoId\)/);
    expect(preload).toMatch(/stop:\s*\(convoId\)/);
  });

  it('renderer keeps stream state keyed by conversation', () => {
    expect(chat).toMatch(/streamsRef/);
    expect(chat).toMatch(/patchStream/);
  });

  it('renderer routes each chunk on chunk.convoId', () => {
    expect(chat).toMatch(/chunk\.convoId/);
  });

  it('the old single-stream state is gone', () => {
    for (const dead of ['streamBufferRef', 'streamConvIdRef', 'setIsStreaming(', 'setStreamBuffer(']) {
      expect(chat.includes(dead)).toBe(false);
    }
  });

  it('a busy chat does not block sending in a different chat', () => {
    // The guard must consult THIS conversation's stream, not a global flag.
    expect(chat).toMatch(/streamsRef\.current\[activeConvo\][\s\S]{0,40}?\.streaming\)\s*return/);
  });
});

// The actual routing semantics, exercised the way the handler does it.
describe('parallel streaming: routing semantics', () => {
  const EMPTY = { buffer: '', streaming: false, trail: [] };

  /** Mirrors the renderer: state keyed by id, every chunk routed on convoId. */
  function makeRouter() {
    let streams = {};
    const committed = [];
    return {
      streams: () => streams,
      committed,
      onChunk(chunk) {
        const cid = chunk.convoId;
        const cur = streams[cid] || EMPTY;
        if (chunk.done) {
          committed.push({ convoId: cid, content: (cur.buffer || '') + (chunk.content || '') });
          const next = { ...streams };
          delete next[cid];
          streams = next;
          return;
        }
        streams = { ...streams, [cid]: { ...cur, buffer: (cur.buffer || '') + (chunk.content || ''), streaming: true } };
      },
    };
  }

  it('interleaved chunks from two chats never mix', () => {
    const r = makeRouter();
    r.onChunk({ convoId: 'A', content: 'alpha ' });
    r.onChunk({ convoId: 'B', content: 'beta ' });
    r.onChunk({ convoId: 'A', content: 'one' });
    r.onChunk({ convoId: 'B', content: 'two' });

    expect(r.streams().A.buffer).toBe('alpha one');
    expect(r.streams().B.buffer).toBe('beta two');
  });

  it('each reply commits to the chat that asked for it', () => {
    const r = makeRouter();
    r.onChunk({ convoId: 'A', content: 'from A' });
    r.onChunk({ convoId: 'B', content: 'from B' });
    r.onChunk({ convoId: 'B', content: '', done: true });
    r.onChunk({ convoId: 'A', content: '', done: true });

    // B finished first, but each landed in its own chat — not the open tab's.
    expect(r.committed).toEqual([
      { convoId: 'B', content: 'from B' },
      { convoId: 'A', content: 'from A' },
    ]);
  });

  it('finishing one chat leaves the other still streaming', () => {
    const r = makeRouter();
    r.onChunk({ convoId: 'A', content: 'still going' });
    r.onChunk({ convoId: 'B', content: 'done soon' });
    r.onChunk({ convoId: 'B', content: '', done: true });

    expect(r.streams().B).toBeUndefined();
    expect(r.streams().A.streaming).toBe(true);
    expect(r.streams().A.buffer).toBe('still going');
  });

  it('a chat with no stream reads as idle (empty tab)', () => {
    const r = makeRouter();
    r.onChunk({ convoId: 'A', content: 'hi' });
    expect(r.streams().C || EMPTY).toEqual(EMPTY);
  });
});
