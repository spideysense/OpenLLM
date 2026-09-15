const crypto = require('crypto');
const { EventEmitter } = require('events');
const execution = require('./execution-context');
const engine = require('./gateway-agent');
const store = require('./store');
const conversations = require('./conversations');
const events = new EventEmitter();
const active = new Map();
let initialized = false;
function recover() {
  if (initialized) return;
  const jobs = store.get('chatJobs') || {};
  for (const job of Object.values(jobs)) {
    if (!job.done) {
      job.done = true;
      job.seq++;
      job.error = 'Aspen restarted. You can retry this request.';
      finishConversation(job);
    }
  }
  store.set('chatJobs', jobs);
  initialized = true;
}
function finishConversation(job) {
  const current = conversations.load().find((c) => c.id === job.convoId);
  if (current && !current.messages.some((m) => m.requestId === job.requestId))
    conversations.upsert({
      ...current,
      messages: [
        ...current.messages,
        {
          role: 'assistant',
          content: job.buffer,
          requestId: job.requestId,
          trail: job.trail.filter((s) => !s.transient),
          error: job.error,
          aborted: job.aborted
        }
      ]
    });
}
function snapshot() {
  recover();
  return Object.values(store.get('chatJobs') || {});
}
async function* run(args) {
  const checkAccess = () => { if (args.authorized && !args.authorized()) throw new Error('This device key has been revoked.'); };
  checkAccess();
  if (args.boost) {
    if (!args.isOwner) throw new Error('Only the owner can use Cloud Boost.');
    const cloud = require('./cloud');
    cloud.syncFromStore();
    if (!cloud.enabled())
      throw new Error(
        'Enable Cloud Boost and add a provider key in Settings first.'
      );
    const result = await cloud.boost(args.messages, { signal: args.signal });
    args.signal?.throwIfAborted();
    if (!result?.text)
      throw new Error(
        'Your cloud providers are unavailable. Try again or use the local model.'
      );
    yield { type: 'model', name: `cloud:${result.provider}` };
    yield { type: 'content', text: result.text + (result.marker || '') };
    yield { type: 'done' };
    return;
  }
  const preemption = new AbortController();
  if (args.background)
    args = {
      ...args,
      signal: args.signal
        ? AbortSignal.any([args.signal, preemption.signal])
        : preemption.signal
    };
  const foreground = require('./foreground');
  if (!args.background) foreground.begin();
  let release, iterator;
  const requestContext = { signal: args.signal, authorized: args.authorized, person: args.isOwner ? 'owner' : args.personId || args.memoryKeyId || null };
  try {
    release = await require('./admission').acquire(args.signal, {
      background: !!args.background,
      onPreempt: () =>
        preemption.abort(new Error('Paused for a foreground request.'))
    });
    iterator = engine.runValidated(args)[Symbol.asyncIterator]();
    while (true) {
      args.signal?.throwIfAborted();
      checkAccess();
      const next = await execution.run(requestContext, () =>
        iterator.next()
      );
      if (next.done) break;
      args.signal?.throwIfAborted();
      checkAccess();
      if (next.value.type === 'error') throw new Error(next.value.text);
      yield next.value;
    }
  } catch (error) {
    if (!args.isOwner || args.background || args.signal?.aborted || (args.authorized && !args.authorized())) throw error;
    const cloud = require('./cloud'); cloud.syncFromStore();
    const fallback = await cloud.autoFallback(args.messages, { localFailed: true, signal: args.signal });
    args.signal?.throwIfAborted();
    if (!fallback?.text) throw error;
    yield { type: 'model', name: `cloud:${fallback.provider}` };
    yield { type: 'content', text: fallback.text + (fallback.marker || '') };
    yield { type: 'done' };
  } finally {
    try {
      await execution.run(requestContext, () => iterator?.return?.());
    } finally {
      release?.();
      if (!args.background) foreground.end();
    }
  }
}
function stop(id) {
  const ctrl = active.get(id);
  if (!ctrl) return { success: false, error: 'No active chat' };
  ctrl.abort();
  return { success: true };
}
function stopAll() {
  for (const id of active.keys()) stop(id);
}
async function send({ model, messages, convoId, boost = false }) {
  recover();
  if (!model || !Array.isArray(messages) || !messages.length || convoId == null)
    throw new Error('Model, messages and conversation are required.');
  if (active.has(convoId))
    throw new Error('This conversation is already generating.');
  const ctrl = new AbortController();
  const job = {
    convoId,
    requestId: crypto.randomUUID(),
    model,
    buffer: '',
    trail: [],
    done: false,
    seq: 0
  };
  const existing = conversations.load().find((c) => c.id === convoId);
  conversations.upsert({
    ...existing,
    id: convoId,
    title:
      existing?.title ||
      String(messages.find((m) => m.role === 'user')?.content || 'Chat').slice(
        0,
        60
      ),
    messages
  });
  let lastSave = 0;
  const persist = () => {
    if (ctrl.forgotten) return;
    const jobs = store.get('chatJobs') || {};
    jobs[convoId] = job;
    store.set('chatJobs', jobs);
    lastSave = Date.now();
  };
  persist();
  active.set(convoId, ctrl);
  const emit = (chunk) => {
    job.seq++;
    events.emit('stream', {
      ...chunk,
      convoId,
      requestId: job.requestId,
      seq: job.seq
    });
  };
  const instruction = store.get('customInstructions') || '';
  const input = [
    {
      role: 'system',
      content: `You are Aspen. The date is ${new Date().toISOString()}. ${instruction}`
    },
    ...messages
  ];
  try {
    for await (const event of run({
      model,
      messages: input,
      boost,
      isOwner: true,
      memoryKeyId: 'owner',
      signal: ctrl.signal,
      allowComputerUse: store.get('computerUseEnabled') === true
    })) {
      if (event.type === 'content') {
        job.buffer += event.text;
        emit({ content: event.text, done: false });
      }
      if (event.type === 'model') {
        job.model = event.name;
        emit({ model: event.name });
      }
      if (event.type === 'error') throw new Error(event.text);
      if (event.type === 'status' || event.type === 'tool_call') {
        const step = {
          status: event.statusText || event.text || event.name,
          tool: event.name,
          transient: !!event.transient
        };
        job.trail.push(step);
        emit({
          aspen_status: step.status,
          aspen_tool: step.tool,
          aspen_transient: step.transient
        });
      }
      if (Date.now() - lastSave > 500) persist();
    }
  } catch (error) {
    job.error = ctrl.signal.aborted ? null : error.message;
    job.aborted = ctrl.signal.aborted;
  } finally {
    job.done = true;
    active.delete(convoId);
    try {
      if (!ctrl.forgotten) finishConversation(job);
      // Reserve the terminal sequence before saving, so reconnect replay is ordered.
      job.seq++;
      persist();
    } catch (error) {
      job.error = `Could not save the reply: ${error.message}`;
    }
    emit({ done: true, content: '', error: job.error, aborted: job.aborted });
  }
  return {
    success: !job.error,
    requestId: job.requestId,
    error: job.error,
    aborted: job.aborted
  };
}
function forget(id) {
  const ctrl = active.get(id);
  if (ctrl) ctrl.forgotten = true;
  stop(id);
  const jobs = store.get('chatJobs') || {};
  delete jobs[id];
  store.set('chatJobs', jobs);
}
function forgetAll() {
  for (const id of active.keys()) {
    active.get(id).forgotten = true;
    stop(id);
  }
  store.set('chatJobs', {});
}
module.exports = {
  forgetAll,
  send,
  run,
  stop,
  stopAll,
  snapshot,
  forget,
  events
};
