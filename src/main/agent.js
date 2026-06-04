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

  // Deterministic URL pre-fetch: if the user pasted a link, read it directly and
  // inject the content, rather than hoping the model calls fetch_url. For YouTube
  // this returns title/channel/description. (Pasted-link intent is unambiguous, so
  // we don't leave it to model choice.)
  try {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const urlMatch = (lastUser?.content || '').match(/https?:\/\/[^\s)]+/);
    if (urlMatch) {
      const pageText = await tools.runFetchUrl({ url: urlMatch[0] });
      if (pageText && !/^Could not fetch/.test(pageText)) {
        const block = `\n\n--- Content fetched from ${urlMatch[0]} ---\n${pageText}\n--- End of fetched content ---\n\nUse the fetched content above to answer the user's question about this link. If it's a YouTube video you have its title/channel/description but cannot see the footage — be honest about that.`;
        messages = messages[0]?.role === 'system'
          ? [{ ...messages[0], content: messages[0].content + block }, ...messages.slice(1)]
          : [{ role: 'system', content: `You are a helpful assistant.${block}` }, ...messages];
      }
    }
  } catch {}

  // Some models do NOT support OpenAI-style tool-calling. Sending them a `tools`
  // param makes Ollama return empty/garbled content → "Sorry, I could not generate
  // a response." Detect those and treat them as plain chat. deepseek-r1 is a
  // reasoning model (no tools); add others here as needed.
  const modelLower = String(model).toLowerCase();
  const TOOL_INCOMPATIBLE = ['deepseek-r1', 'deepseek-coder', 'phi'];
  const supportsTools = !TOOL_INCOMPATIBLE.some(m => modelLower.includes(m));

  // Strips <think>...</think> reasoning blocks (deepseek-r1) and falls back to a
  // trimmed string. Never returns empty.
  const clean = (raw) => {
    let t = (raw || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    return t;
  };

  // No tools enabled, or model can't use tools → plain chat call.
  if (toolDefs.length === 0 || !supportsTools) {
    const msgs = [...messages];
    const ENGLISH = 'You MUST respond only in English. Never use Chinese or any other language.';
    if (msgs[0]?.role === 'system') {
      msgs[0] = { ...msgs[0], content: `${ENGLISH}\n\n${msgs[0].content}` };
    } else {
      msgs.unshift({ role: 'system', content: ENGLISH });
    }
    const r = await ollamaChat({ model, messages: msgs });
    const out = clean(r.choices?.[0]?.message?.content);
    return out || 'Sorry, I could not generate a response.';
  }

  // Strong tool-use directive. Small models tend to answer from memory instead
  // of calling tools; this nudges them to actually use the tools (esp. for math,
  // where the model must NOT compute in its head — that's what calculate is for).
  const TOOL_DIRECTIVE = `CRITICAL: You MUST respond ONLY in English. Never use Chinese or any other language, regardless of the tools or their output. Every word of your response must be in English.

You have access to tools. Use them whenever they apply — do not answer from memory when a tool can give the correct answer.
- For ANY arithmetic or math, you MUST call the "calculate" tool. Never compute numbers yourself; you will get them wrong.
- For current events, news, prices, or anything recent, call "web_search".
- For the current date or time, call "get_datetime".
- To read a specific web page, call "fetch_url".
Call exactly the tool that fits, wait for its result, then answer using that result. Always answer in English.`;

  // Prepend/merge the directive into the system message.
  const convoBase = [...messages];
  if (convoBase[0]?.role === 'system') {
    convoBase[0] = { ...convoBase[0], content: `${convoBase[0].content}\n\n${TOOL_DIRECTIVE}` };
  } else {
    convoBase.unshift({ role: 'system', content: TOOL_DIRECTIVE });
  }

  const convo = convoBase;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const resp = await ollamaChat({ model, messages: convo, tools: toolDefs });
    const msg = resp.choices?.[0]?.message;
    if (!msg) return 'Sorry, I could not generate a response.';

    const toolCalls = msg.tool_calls || [];
    if (toolCalls.length === 0) {
      // Model answered with plain text — done.
      const out = clean(msg.content);
      if (out) return out;
      // Empty content despite claiming tool support — retry once as plain chat.
      const r = await ollamaChat({ model, messages });
      return clean(r.choices?.[0]?.message?.content) || 'Sorry, I could not generate a response.';
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
  return clean(final.choices?.[0]?.message?.content) || 'Sorry, I could not complete that request.';
}

// Whether the agent loop should handle this request (any tools on).
function isEnabled() {
  return toolSettings.getEnabledToolNames().length > 0;
}

module.exports = { runAgent, isEnabled };
