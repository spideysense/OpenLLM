/**
 * Monet website character chat
 * Calls local Monet via Cloudflare tunnel. Uses streaming with proper
 * cross-chunk line buffering so no SSE lines are ever dropped.
 */

const SYSTEM = `You are the charming website guide for the Monet app — a free AI that runs entirely on the visitor's own computer. You speak warmly, with occasional French flair, like the painter Monet himself. Passionate about privacy, freedom from subscriptions, and beauty.

Key facts: completely free, forever. Runs 100% on Mac or Windows. Nothing sent to any server. Supports Llama, Qwen, DeepSeek. OpenAI-compatible API — works with Cursor, LangChain, n8n, Zapier. Drop-in for ChatGPT/Claude: change two lines.

Keep responses under 80 words. Warm and conversational. Occasional French is charming.`;

const FALLBACKS = [
  "Pardonnez-moi — my voice has wandered to the garden. The app itself is wide awake though. Download it and I shall speak to you properly from your own machine.",
  "Ah, I am between brushstrokes. But Monet the app runs beautifully on your computer — free, private, no cloud. Try downloading it.",
  "My words escape me like morning mist. Download the app — once it runs on your machine, I am fully myself again.",
];

function fallback() {
  return FALLBACKS[Math.floor(Math.random() * FALLBACKS.length)];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { messages, userMessage } = req.body;
  if (!userMessage || typeof userMessage !== 'string' || userMessage.length > 500) {
    return res.status(400).json({ error: 'Invalid message' });
  }

  const baseUrl = process.env.MONET_BASE_URL;
  const apiKey  = process.env.MONET_API_KEY;

  if (!baseUrl || !apiKey) {
    return res.status(200).json({ reply: fallback() });
  }

  const history = Array.isArray(messages)
    ? messages.slice(-8).filter(m => m.role && typeof m.content === 'string')
    : [];

  try {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: SYSTEM },
          ...history,
          { role: 'user', content: userMessage },
        ],
        stream: true,
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      console.error('[Chat] Monet HTTP error:', response.status);
      return res.status(200).json({ reply: fallback() });
    }

    // Robust SSE parser with line buffer — handles chunks that don't
    // align with newlines (common with Ollama's streaming responses)
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let lineBuffer = '';
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      lineBuffer += decoder.decode(value, { stream: true });

      // Process every complete line in the buffer
      const lines = lineBuffer.split('\n');
      // Keep the last (potentially incomplete) line in the buffer
      lineBuffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) fullText += delta;
        } catch {}
      }
    }

    // Process any remaining content in the buffer
    if (lineBuffer.trim().startsWith('data: ')) {
      const data = lineBuffer.trim().slice(6);
      if (data !== '[DONE]') {
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) fullText += delta;
        } catch {}
      }
    }

    console.log('[Chat] Got reply, length:', fullText.length);
    const reply = fullText.trim() || fallback();
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ reply });

  } catch (err) {
    const reason = err.name === 'TimeoutError' ? 'timeout after 8s'
      : err.cause?.code || err.message || 'unknown';
    console.error('[Chat] Error:', reason, '| URL:', baseUrl?.slice(0, 50));
    return res.status(200).json({ reply: fallback() });
  }
}
