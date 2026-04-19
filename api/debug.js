/**
 * Debug endpoint — shows env vars, tunnel reachability, AND raw SSE output
 * so we can see exactly what Ollama returns and verify our parsing is correct.
 */
export default async function handler(req, res) {
  const baseUrl = process.env.MONET_BASE_URL;
  const apiKey  = process.env.MONET_API_KEY;

  const result = {
    baseUrl: baseUrl || '(not set)',
    hasKey: !!apiKey,
    region: process.env.VERCEL_REGION || 'unknown',
  };

  if (!baseUrl || !apiKey) {
    return res.status(200).json({ ...result, error: 'env vars not set' });
  }

  // Test 1: /v1/models — confirms auth works
  try {
    const r = await fetch(`${baseUrl}/v1/models`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    result.modelsStatus = r.status;
    result.modelsOk = r.ok;
    if (r.ok) result.models = await r.json();
  } catch(e) {
    result.modelsError = e.message;
  }

  // Test 2: streaming chat — collect raw SSE and parsed text
  try {
    const r = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Say only: hello' }],
        stream: true,
      }),
      signal: AbortSignal.timeout(8000),
    });

    result.chatStatus = r.status;
    result.chatHeaders = Object.fromEntries(r.headers.entries());

    if (r.ok) {
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let raw = '';
      let lineBuffer = '';
      let fullText = '';
      let chunkCount = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        raw += chunk;
        chunkCount++;

        lineBuffer += chunk;
        const lines = lineBuffer.split('\n');
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

      result.chatChunks = chunkCount;
      result.chatRawBytes = raw.length;
      result.chatRawPreview = raw.slice(0, 500); // first 500 chars of raw SSE
      result.chatParsedText = fullText;
      result.chatParsedLength = fullText.length;
    }
  } catch(e) {
    result.chatError = e.message;
  }

  return res.status(200).json(result);
}
