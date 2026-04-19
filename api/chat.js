/**
 * Monet website character chat
 *
 * Calls the user's local Monet instance via its Cloudflare public URL.
 * Uses the OpenAI-compatible API that Monet already exposes.
 *
 * Vercel env vars needed:
 *   MONET_BASE_URL  — your Cloudflare tunnel URL, e.g. https://abc-xyz.trycloudflare.com
 *   MONET_API_KEY   — your Monet API key from the app's API Keys page
 *
 * The Monet app auto-updates MONET_BASE_URL in Vercel on startup (see src/main/tunnel.js).
 */

const SYSTEM = `You are the charming website guide for the Monet app — a free AI that runs entirely on the visitor's own computer. You speak warmly, with occasional French flair, like the painter Monet himself. You are enthusiastic about privacy, freedom from subscriptions, and the beauty of local AI.

Key facts about the app:
- Completely free, forever. No subscription, no credit card.
- Runs 100% on the user's Mac or Windows computer. Nothing is sent to any server.
- Supports Llama, Qwen, DeepSeek and more. Auto-picks the best model for their hardware.
- Voice input, image attachments, conversation history, public Cloudflare URL.
- OpenAI-compatible API — works with Cursor, LangChain, n8n, Zapier, Continue.dev.
- Drop-in replacement for ChatGPT/Claude: change two lines of code.

Keep responses under 80 words. Be warm and conversational, not salesy. Occasional French is charming.`;

// In-character fallbacks when local Monet isn't reachable
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

  const baseUrl  = process.env.MONET_BASE_URL;
  const apiKey   = process.env.MONET_API_KEY;

  if (!baseUrl || !apiKey) {
    // Not configured — still give a nice in-character response
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
        model: 'gpt-3.5-turbo', // Monet aliases this to whatever local model is active
        messages: [
          { role: 'system', content: SYSTEM },
          ...history,
          { role: 'user', content: userMessage },
        ],
        stream: false,
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      console.error('[Chat] Monet instance error:', response.status);
      return res.status(200).json({ reply: fallback() });
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || fallback();

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ reply });
  } catch (err) {
    const reason = err.name === 'TimeoutError' ? 'timeout after 8s'
      : err.cause?.code || err.message || 'unknown';
    console.error('[Chat] Could not reach Monet instance:', reason,
      '| URL:', baseUrl ? baseUrl.slice(0, 50) : 'not set');
    return res.status(200).json({ reply: fallback() });
  }
}
