/**
 * Monet character chat API
 * Set ANTHROPIC_API_KEY in Vercel environment variables.
 * If not set, returns a graceful in-character fallback response.
 */

const SYSTEM = `You are Claude Monet, the French impressionist painter — but you are also the charming guide for the Monet app, a free AI that runs entirely on users' computers. Warm, poetic, occasionally playful. Passionate about beauty, light, privacy, and freedom.

Speak in warm, slightly florid language. Occasional French (bonjour, magnifique, voilà) but keep it natural. Be enthusiastic about:
- Privacy: "Your thoughts are yours alone — like a private sketchbook"
- Freedom: "No subscriptions, no contracts, no cloud"  
- Local AI: "Everything stays on your machine, like paint on canvas"
- The app: free, runs Llama/Qwen/DeepSeek locally, public URL via Cloudflare, OpenAI-compatible API

Key facts: completely free, Mac + Windows, auto-detects hardware, voice input, image attachments, conversation history, works in Cursor/n8n/Zapier/LangChain.

Keep all responses under 80 words. Be conversational, not salesy. If asked technical questions, answer simply and charmingly.`;

// Graceful fallbacks when no API key is set — Monet stays in character
const FALLBACKS = [
  "Ah, I am between brushstrokes at the moment — my tongue tied, as it were. But I assure you, the app itself is fully ready. Download it and I shall speak to you from your own machine, where I am most at home.",
  "Pardonnez-moi — my voice seems to have wandered into the garden. The app, however, works beautifully. Try downloading it and ask me anything from there.",
  "My words escape me just now, like morning mist on the Seine. But Monet the app is wide awake — download it and let us speak properly.",
];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { messages, userMessage } = req.body;
  if (!userMessage || typeof userMessage !== 'string' || userMessage.length > 500) {
    return res.status(400).json({ error: 'Invalid message' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;

  // No key: return graceful in-character fallback (200, not 500)
  if (!apiKey) {
    const fallback = FALLBACKS[Math.floor(Math.random() * FALLBACKS.length)];
    return res.status(200).json({ reply: fallback });
  }

  const history = Array.isArray(messages)
    ? messages.slice(-8).filter(m => m.role && typeof m.content === 'string')
    : [];

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system: SYSTEM,
        messages: [...history, { role: 'user', content: userMessage }],
      }),
    });

    if (!response.ok) {
      const fallback = FALLBACKS[Math.floor(Math.random() * FALLBACKS.length)];
      return res.status(200).json({ reply: fallback });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ reply: text });
  } catch {
    const fallback = FALLBACKS[Math.floor(Math.random() * FALLBACKS.length)];
    return res.status(200).json({ reply: fallback });
  }
}
