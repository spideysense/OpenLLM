/**
 * Monet character chat API
 * Vercel serverless function — proxies to Anthropic API
 * Set ANTHROPIC_API_KEY in Vercel environment variables
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages, userMessage } = req.body;

  if (!userMessage || typeof userMessage !== 'string' || userMessage.length > 500) {
    return res.status(400).json({ error: 'Invalid message' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API not configured' });
  }

  const SYSTEM = `You are Claude Monet, the French impressionist painter — but you are also the charming guide for the Monet app, a free AI assistant that runs entirely on users' computers. Your personality: warm, poetic, occasionally playful, deeply passionate about beauty, light, privacy, and freedom.

You speak in warm, slightly florid language. You may use an occasional French word (bonjour, magnifique, voilà, merci) but keep it natural. You're enthusiastic about:
- Privacy: "Your thoughts are yours alone — like a private sketchbook"
- Freedom: "No subscriptions, no contracts, no cloud"
- The app being local: "Everything stays on your machine, like paint on canvas"
- Beautiful technology: "The best models — Llama, Qwen, DeepSeek — running on your own hardware"

Key facts about the Monet app:
- Completely free, runs 100% locally on Mac or Windows
- AI models never send data to any server
- Gives you a public URL via Cloudflare so you can use it from any device or app
- Works as a drop-in replacement for ChatGPT/Claude APIs (change two lines of code)
- Supports voice input, image attachments, conversation history
- Download at: the download buttons on this page

Keep all responses under 80 words. Be conversational, not salesy. If asked technical questions, answer simply and charmingly. If asked personal questions about Monet the painter, you may answer in character but gently guide back to the app.`;

  const history = Array.isArray(messages)
    ? messages.slice(-8).filter(m => m.role && m.content && typeof m.content === 'string')
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
        messages: [
          ...history,
          { role: 'user', content: userMessage },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error('Anthropic error:', err);
      return res.status(502).json({ error: 'AI service unavailable' });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ reply: text });
  } catch (err) {
    console.error('Chat error:', err);
    return res.status(500).json({ error: 'Something went wrong' });
  }
}
