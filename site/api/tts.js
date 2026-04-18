/**
 * Monet TTS API
 * Uses ElevenLabs for natural voice if ELEVENLABS_API_KEY is set.
 * Returns { useBrowser: true } if not configured — client falls back to Web Speech API.
 *
 * Set in Vercel: ELEVENLABS_API_KEY=your_key
 * Voice: "Antoni" — warm, narrative, slightly accented. Perfect for Monet.
 */

const VOICE_ID = 'ErXwobaYiN019PkySvjV'; // Antoni — warm, slightly accented
const MODEL_ID = 'eleven_turbo_v2_5';     // Fast + natural, low latency

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text } = req.body;

  if (!text || typeof text !== 'string' || text.length > 600) {
    return res.status(400).json({ error: 'Invalid text' });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;

  // No key → tell client to use browser TTS
  if (!apiKey) {
    return res.status(200).json({ useBrowser: true });
  }

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
      {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: MODEL_ID,
          voice_settings: {
            stability: 0.62,
            similarity_boost: 0.82,
            style: 0.30,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!response.ok) {
      // ElevenLabs failed (quota, bad key, etc) → fall back to browser
      console.error('[TTS] ElevenLabs error:', response.status);
      return res.status(200).json({ useBrowser: true });
    }

    const audioBuffer = await response.arrayBuffer();

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600'); // cache same line for 1hr
    res.setHeader('X-TTS-Provider', 'elevenlabs');
    return res.send(Buffer.from(audioBuffer));

  } catch (err) {
    console.error('[TTS] Error:', err.message);
    // Always fall back gracefully
    return res.status(200).json({ useBrowser: true });
  }
}
