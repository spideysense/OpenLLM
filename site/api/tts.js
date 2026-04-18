/**
 * Monet TTS API — multi-provider, free-first
 *
 * Priority chain (use whichever key is set):
 *   1. Azure Cognitive Services Neural TTS — 500K chars/month free forever (F0 tier)
 *      Set: AZURE_SPEECH_KEY + AZURE_SPEECH_REGION (e.g. "eastus")
 *      No credit card needed for F0 tier.
 *
 *   2. Google Cloud TTS — 1M WaveNet chars/month free
 *      Set: GOOGLE_TTS_KEY
 *
 *   3. No key → { useBrowser: true }
 *      Client falls back to Chrome/Safari built-in neural voices (genuinely good)
 */

const AZURE_VOICE  = 'en-US-DavisNeural'; // warm, confident, slightly deep
const GOOGLE_VOICE = 'en-GB-Neural2-D';   // warm British male

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { text } = req.body;
  if (!text || typeof text !== 'string' || text.length > 600)
    return res.status(400).json({ error: 'Invalid text' });

  // Azure
  const azureKey    = process.env.AZURE_SPEECH_KEY;
  const azureRegion = process.env.AZURE_SPEECH_REGION || 'eastus';
  if (azureKey) {
    try {
      const ssml = `<speak version='1.0' xml:lang='en-US'><voice name='${AZURE_VOICE}'><prosody rate='-8%' pitch='-3%'>${esc(text)}</prosody></voice></speak>`;
      const r = await fetch(`https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': azureKey,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3',
          'User-Agent': 'MonetApp',
        },
        body: ssml,
      });
      if (r.ok) {
        const buf = await r.arrayBuffer();
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Cache-Control', 'private, max-age=3600');
        res.setHeader('X-TTS-Provider', 'azure');
        return res.send(Buffer.from(buf));
      }
      console.error('[TTS] Azure', r.status);
    } catch(e) { console.error('[TTS] Azure exception', e.message); }
  }

  // Google Cloud TTS
  const googleKey = process.env.GOOGLE_TTS_KEY;
  if (googleKey) {
    try {
      const r = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${googleKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode: 'en-GB', name: GOOGLE_VOICE },
          audioConfig: { audioEncoding: 'MP3', speakingRate: 0.90, pitch: -2.0, volumeGainDb: 1.0 },
        }),
      });
      if (r.ok) {
        const data = await r.json();
        const buf  = Buffer.from(data.audioContent, 'base64');
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Cache-Control', 'private, max-age=3600');
        res.setHeader('X-TTS-Provider', 'google');
        return res.send(buf);
      }
      console.error('[TTS] Google', r.status);
    } catch(e) { console.error('[TTS] Google exception', e.message); }
  }

  // No key — tell client to use browser TTS
  return res.status(200).json({ useBrowser: true });
}

function esc(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
          .replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}
