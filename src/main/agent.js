/**
 * Agent loop for Aspen.
 *
 * The local LLM decides everything: whether a tool is needed and which one.
 * No keyword shortcuts. We give the model the enabled tools, and if it emits
 * tool_calls we run them locally (tools.js) and feed results back, looping
 * until the model answers with plain text.
 *
 * Everything here runs in the Electron process on the user's machine.
 */
const http = require('http');
const tools = require('./tools');
const toolSettings = require('./tool-settings');

const OLLAMA_HOST = '127.0.0.1';
const OLLAMA_PORT = 11434;
const MAX_TOOL_ROUNDS = 4; // safety cap so a confused model can't loop forever

// One non-streaming call to Ollama's OpenAI-compatible endpoint.
function ollamaChat(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ ...payload, stream: false });
    const req = http.request(
      {
        hostname: OLLAMA_HOST,
        port: OLLAMA_PORT,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
          catch (e) { reject(e); }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Run the tool-using loop. Returns the final assistant message content (string).
 * `messages` is the OpenAI-style array. `model` is the resolved Ollama model.
 */
async function runAgent({ model, messages }) {
  const enabled = toolSettings.getEnabledToolNames();
  const toolDefs = tools.getToolDefinitions(enabled);

  // No tools enabled → behave exactly like a plain chat call.
  if (toolDefs.length === 0) {
    const r = await ollamaChat({ model, messages });
    return r.choices?.[0]?.message?.content || '';
  }

  const convo = [...messages];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const resp = await ollamaChat({ model, messages: convo, tools: toolDefs });
    const msg = resp.choices?.[0]?.message;
    if (!msg) return '';

    const toolCalls = msg.tool_calls || [];
    if (toolCalls.length === 0) {
      // Model answered with plain text — done.
      return msg.content || '';
    }

    // Record the assistant's tool-call turn, then execute each call locally.
    convo.push(msg);
    for (const call of toolCalls) {
      const name = call.function?.name;
      let args = {};
      try { args = JSON.parse(call.function?.arguments || '{}'); } catch {}
      const result = await tools.executeTool(name, args);
      convo.push({
        role: 'tool',
        tool_call_id: call.id,
        name,
        content: typeof result === 'string' ? result : JSON.stringify(result),
      });
    }
    // loop: model now sees the tool results and continues
  }

  // Hit the round cap — make one final plain call so the user still gets an answer.
  const final = await ollamaChat({ model, messages: convo });
  return final.choices?.[0]?.message?.content || '';
}

// Whether the agent loop should handle this request (any tools on).
function isEnabled() {
  return toolSettings.getEnabledToolNames().length > 0;
}

module.exports = { runAgent, isEnabled };
