/**
 * Monet website character chat
 *
 * Calls the user's local Monet instance via its Cloudflare public URL.
 * Uses streaming (stream:true) and collects the full response server-side.
 * This avoids the chunked-encoding issue where stream:false causes Vercel's
 * fetch to hang waiting for Content-Length that Ollama never sends.
 *
 * Vercel env vars:
 *   MONET_BASE_URL  — Cloudflare tunnel URL e.g. https://abc.trycloudflare.com
 *   MONET_API_KEY   — API key from the Monet app's API Keys page
 */

const SYSTEM = `You are the charming website guide for the Monet app — a free AI that runs entirely on the visitor's own computer. You speak warmly, with occasional French flair, like the painter Monet himself. Passionate about privacy, freedom from subscriptions, and beauty.

Key facts:
- Completely free, forever. No subscription, no credit card.
- Runs 100% on Mac or Windows. Nothing sent to any server.
- Supports Llama, Qwen, DeepSeek. Auto-picks the best model.
- Voice input, image attachments, conversation history, public Cloudflare URL.
- OpenAI-compatible API — Cursor, LangChain, n8n, Zapier, Continue.dev.
- Drop-in replacement for ChatGPT/Claude: change two lines of code.

Keep responses under 80 words. Warm and conversational. Occasional French is charming.`;

const FALLBACKS = [
  "Pardonnez-moi — it seems my voice has wandered off to the garden. But the app itself is wide awake. Download it, and I shall speak to you properly from your own machine.",
  "Ah, I am between brushstrokes just now. But Monet the app runs beautifully on your computer — free, private, no cloud needed. Try downloading it.",
  "My words escape me at this moment, like morning mist. Do download the app — once it runs on your machine, I am fully myself again.",
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
    // Use stream:true — Ollama handles chunked streaming correctly.
    // stream:false causes Ollama to send chunked encoding without Content-Length
    // which hangs Vercel's fetch. We collect the stream and reassemble here.
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
      console.error('[Chat] Monet error:', response.status);
      return res.status(200).json({ reply: fallback() });
    }

    // Collect streamed SSE chunks and extract the text
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') break;
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) fullText += delta;
        } catch {}
      }
    }

    const reply = fullText.trim() || fallback();
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ reply });

  } catch (err) {
    const reason = err.name === 'TimeoutError' ? 'timeout after 8s'
      : err.cause?.code || err.message || 'unknown';
    console.error('[Chat] Could not reach Monet instance:', reason,
      '| URL:', baseUrl?.slice(0, 50));
    return res.status(200).json({ reply: fallback() });
  }
}
