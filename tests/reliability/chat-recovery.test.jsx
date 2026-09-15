import React from 'react';
import { render, act, cleanup, fireEvent } from '@testing-library/react';
import { vi, test, expect, afterEach } from 'vitest';
const ctx = vi.hoisted(() => ({ value: null }));
vi.mock('../../src/renderer/App.jsx', () => ({ useApp: () => ctx.value }));
vi.mock('../../src/renderer/lib/tts', () => ({ default: { setCallbacks() {}, preload() {}, stop() {} } }));
import Chat from '../../src/renderer/pages/Chat.jsx';
afterEach(cleanup);

test('the actual Chat component restores a completed reply after missing all terminal events', async () => {
  const listeners = new Set(); let jobs = [];
  let conversations = [{ id: 'recovery', title: 'Test', messages: [{ role: 'user', content: 'hello' }] }];
  Element.prototype.scrollIntoView = () => {};
  localStorage.setItem('aspen_fb_v1', 'shown');
  const bridge = {
    store: { get: async () => null, set: async () => true },
    chat: { onStream: fn => { listeners.add(fn); return () => listeners.delete(fn); }, snapshot: async () => jobs },
    getModelCapabilities: async () => ({ vision: false }), connectors: { list: async () => [] }
  };
  ctx.value = { bridge, page: 'chat', activeModel: 'test:7b', models: [{ name: 'test:7b' }],
    conversations, activeConvo: 'recovery', missions: [], setPage() {},
    setConversations: fn => { conversations = fn(conversations); ctx.value.conversations = conversations; }
  };
  const view = render(<Chat />); await act(async () => {});
  await act(async () => { for (const fn of listeners) fn({ convoId: 'recovery', requestId: 'r1', seq: 1, content: 'First half ' }); });
  view.rerender(<div>Another screen</div>); expect(listeners.size).toBe(0);
  jobs = [{ convoId: 'recovery', requestId: 'r1', seq: 3, buffer: 'First half second half', trail: [], done: true }];
  view.rerender(<Chat />); await act(async () => {});
  expect(conversations[0].messages.filter(m => m.role === 'assistant')).toHaveLength(1);
  expect(conversations[0].messages.at(-1).content).toBe('First half second half');
  // Per-request cloud consent cannot carry into a different conversation.
  const cloud = view.getByLabelText(/Send this request to cloud/);
  fireEvent.click(cloud); expect(cloud.checked).toBe(true);
  ctx.value.activeConvo = 'another-conversation'; view.rerender(<Chat />);
  expect(view.getByLabelText(/Send this request to cloud/).checked).toBe(false);
  ctx.value.activeConvo = 'recovery'; view.rerender(<Chat />);
  // A late duplicate completion cannot append another copy.
  await act(async () => { for (const fn of listeners) fn({ convoId: 'recovery', requestId: 'r1', seq: 3, done: true }); });
  expect(conversations[0].messages.filter(m => m.role === 'assistant')).toHaveLength(1);
});
