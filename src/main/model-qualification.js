const { normalize } = require('./model-id');
async function qualify(model, { timeoutMs = 180000, signal: callerSignal } = {}) {
  const signal = callerSignal ? AbortSignal.any([callerSignal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  const post = async (path, body) => {
    const res = await fetch(`http://127.0.0.1:11434${path}`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  };
  try {
    const tags = await fetch('http://127.0.0.1:11434/api/tags', {
      signal
    }).then((r) => r.json());
    const installed = tags.models?.find(
      (m) => normalize(m.name) === normalize(model)
    );
    if (!installed?.digest)
      throw new Error('Exact model and digest are not installed');
    const budget = require('./system').getRuntimeBudget();
    if (installed.size / 1e9 > budget.memoryGB)
      throw new Error('Model exceeds this device memory budget');
    const meta = await post('/api/show', { model });
    const options = {
      num_ctx: require('./system').getRecommendedContext(),
      num_predict: 128,
      temperature: 0
    };
    const started = Date.now();
    const answer = await post('/api/chat', {
      model,
      stream: false,
      keep_alive: -1,
      think: false,
      options,
      messages: [{ role: 'user', content: 'Reply with the single word ready.' }]
    });
    if (answer.done !== true || answer.done_reason === 'length' || !/^ready[.!]?$/i.test((answer.message?.content || '').trim()))
      throw new Error('Model failed the chat readiness check');
    let tools = false;
    if (meta.capabilities?.includes('tools')) {
      const call = await post('/api/chat', {
        model,
        stream: false,
        keep_alive: -1,
        think: false,
        options,
        messages: [
          {
            role: 'user',
            content: 'Call readiness_check with value 7. Do not answer in text.'
          }
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'readiness_check',
              description: 'Run the readiness check',
              parameters: {
                type: 'object',
                properties: { value: { type: 'integer' } },
                required: ['value']
              }
            }
          }
        ]
      });
      const tool = call.message?.tool_calls?.find(
        (t) => t.function?.name === 'readiness_check'
      );
      let args = tool?.function?.arguments;
      if (typeof args === 'string') args = JSON.parse(args);
      tools = args?.value === 7;
      if (!tools) throw new Error('Model failed the tool-call readiness check');
    }
    const record = {
      ok: true,
      model: installed.name,
      digest: installed.digest,
      tools,
      vision: !!meta.capabilities?.includes('vision'),
      elapsedMs: Date.now() - started,
      tokensPerSecond: answer.eval_duration
        ? (answer.eval_count * 1e9) / answer.eval_duration
        : null,
      checkedAt: new Date().toISOString()
    };
    const store = require('./store');
    store.set('modelQualifications', {
      ...(store.get('modelQualifications') || {}),
      [normalize(model)]: record
    });
    return record;
  } catch (error) {
    return { ok: false, error: error.message };
  }
}
module.exports = { qualify };
