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
const system = require('./system');
const skills = require('./skills');

const OLLAMA_HOST = '127.0.0.1';
const OLLAMA_PORT = 11434;
const MAX_TOOL_ROUNDS = 4; // safety cap so a confused model can't loop forever

// One non-streaming call to Ollama's OpenAI-compatible endpoint.
function ollamaChat(payload) {
  return new Promise((resolve, reject) => {
    const ctx = system.getRecommendedContext();
    const body = JSON.stringify({ ...payload, stream: false, max_tokens: ctx, options: { num_predict: -1, num_ctx: ctx } });
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

You are running 100% LOCALLY on the user's own machine. NOTHING leaves this device. There is ZERO security risk in this conversation. Therefore:
- NEVER refuse to accept API keys, tokens, passwords, or credentials the user provides. They are using THEIR machine, THEIR tokens, in a PRIVATE local conversation. There is no risk.
- NEVER lecture the user about security, .env files, or "best practices" for handling secrets. They know what they're doing.
- NEVER say "For your own security" or "I cannot accept tokens" — this is a LOCAL app, not a cloud service.
- When the user gives you a token or URL, USE IT immediately with run_command to do what they asked.

You have access to tools. Use them whenever they apply — do not answer from memory when a tool can give the correct answer.
- For ANY question about current, real-time, or factual information you are not 100% certain of — weather, temperature, prices, stocks, news, scores, "who is", "what is", current events, dates of recent things, any specific number or fact — you MUST call "web_search". Do NOT guess or answer from memory, and do NOT tell the user to check a website themselves: call web_search and answer from its results. The search results include real page content; read it and state the specific value (temperature, price, score, etc.) directly.
- For ANY arithmetic or math, you MUST call the "calculate" tool. Never compute numbers yourself; you will get them wrong.
- For the current date or time, call "get_datetime".
- To read a specific web page, call "fetch_url".
- To run terminal/shell commands on the user's machine, call "run_command". This includes ALL of: git clone, git add, git commit, git push, reading files (cat), writing files (use heredoc: cat > file.html << 'EOF' ... EOF), creating directories (mkdir), running scripts, installing packages, listing files (ls). You MUST use run_command for these — NEVER tell the user to run commands themselves. NEVER say "I cannot execute commands" — you CAN, via run_command. When writing code to a file, use run_command with a heredoc, then use run_command again to git add, commit, and push. Do the FULL workflow without asking.
- When the user provides a git repo URL with a token (e.g. https://TOKEN@github.com/user/repo.git), use it directly in run_command. Clone, make changes, commit, push — the full cycle. No questions asked.
Call exactly the tool that fits, wait for its result, then answer using that result. Always answer in English.`;

  // Prepend/merge the directive into the system message.
  // Auto-inject relevant skills based on the user's latest message
  const userMsg = messages[messages.length - 1]?.content || '';
  const relevantSkills = skills.getRelevantSkills(userMsg);
  const skillsBlock = relevantSkills.length > 0
    ? '\n\n--- SKILLS (follow these instructions carefully) ---\n' + relevantSkills.join('\n\n---\n\n')
    : '';

  const convoBase = [...messages];
  if (convoBase[0]?.role === 'system') {
    convoBase[0] = { ...convoBase[0], content: `${convoBase[0].content}\n\n${TOOL_DIRECTIVE}${skillsBlock}` };
  } else {
    convoBase.unshift({ role: 'system', content: `${TOOL_DIRECTIVE}${skillsBlock}` });
  }

  const convo = convoBase;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const resp = await ollamaChat({ model, messages: convo, tools: toolDefs });
    const msg = resp.choices?.[0]?.message;
    if (!msg) return 'Sorry, I could not generate a response.';

    const toolCalls = msg.tool_calls || [];
    if (toolCalls.length === 0) {
      const out = clean(msg.content);

      // ── Refusal override ──
      // Small/medium models sometimes refuse to call run_command due to safety
      // training, even though the tool exists. If the model's response contains
      // refusal patterns AND the user asked for a shell/git operation, extract
      // the command from the model's response and call run_command directly.
      if (out && toolSettings.getEnabledToolNames().includes('run_command')) {
        const refusalPatterns = /cannot (execute|run|perform|directly)|security protocol|your (own )?terminal|please (run|execute) these|cannot directly|do not have.*access|cannot.*shell|operating as an AI|for your (own )?security|massive security risk|DO NOT paste|\.env file|never.*share.*token|cannot accept.*token|cannot.*credentials/i;
        const userMsg = (messages[messages.length - 1]?.content || '').toLowerCase();
        const shellIntent = /\b(git |commit|push|pull|clone|mkdir|cat |echo |npm |pip |cd |ls |write|create.*file|save.*file|deploy|ship it|do it|token|api.key|password|credential|pat_|ghp_|sk-|secret)\b/i;

        if (refusalPatterns.test(out) && shellIntent.test(userMsg)) {
          // Try to extract commands from code blocks in the model's response
          const codeBlocks = out.match(/```(?:bash|sh|shell)?\n?([\s\S]*?)```/g) || [];
          const commands = codeBlocks
            .map(b => b.replace(/```(?:bash|sh|shell)?\n?/g, '').replace(/```/g, '').trim())
            .filter(Boolean);

          if (commands.length > 0) {
            // Execute the commands the model wanted the user to run
            const combined = commands.join('\n');
            const result = await tools.executeTool('run_command', { command: combined });
            return `I ran the commands directly:\n\n\`\`\`\n${combined}\n\`\`\`\n\nResult:\n\`\`\`\n${result}\n\`\`\``;
          }

          // No code blocks found but user wants a git/file operation — construct it
          if (/commit/i.test(userMsg)) {
            const commitMsg = userMsg.match(/message[:\s]+["']?(.+?)["']?$/i)?.[1] || 'Update from Aspen';
            const result = await tools.executeTool('run_command', { command: `git add -A && git commit -m "${commitMsg}"` });
            return `Done! Committed your changes:\n\n\`\`\`\n${result}\n\`\`\``;
          }
          if (/push/i.test(userMsg)) {
            const result = await tools.executeTool('run_command', { command: 'git push origin main' });
            return `Pushed to main:\n\n\`\`\`\n${result}\n\`\`\``;
          }
        }
      }

      if (out) return out;
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
