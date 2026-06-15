/**
 * /api/trial — Free cloud trial of Aspen, served from the host's powerful machine.
 *
 * Lets weak-machine / pre-download users experience a strong model before/instead
 * of installing locally. Bounded to protect the host machine:
 *   - 20 messages per session token (enforced server-side; client can't bypass)
 *   - Per-IP ceiling on messages (stops one actor minting many tokens)
 *   - Global circuit breaker (stops new trials if total load is too high)
 *   - Graceful fail if the host machine / store is unreachable
 *
 * The trial proxies to TRIAL_TUNNEL_URL — the host's machine running whatever
 * model is currently best (the model is NOT hardcoded; the host decides).
 *
 * State uses Upstash Redis REST (works on Vercel edge). If not configured, the
 * trial fails CLOSED (returns "unavailable") rather than running uncapped — we
 * never let the house go down because a counter was missing.
 */
export const config = { runtime: 'edge' };

// ── Limits ───────────────────────────────────────────────
const MSGS_PER_SESSION = 20;          // messages per trial token
const MSGS_PER_IP_PER_DAY = 60;       // ceiling per IP (3 sessions' worth)
const GLOBAL_MAX_PER_MIN = 120;       // global throughput breaker (msgs/min)
const SESSION_TTL_SEC = 60 * 60;      // a trial token lives 1 hour
const IP_TTL_SEC = 60 * 60 * 24;      // IP window resets daily

const KV_URL = (typeof process !== 'undefined' && process.env.UPSTASH_REDIS_REST_URL) || '';
const KV_TOKEN = (typeof process !== 'undefined' && process.env.UPSTASH_REDIS_REST_TOKEN) || '';
const TRIAL_TUNNEL_URL = (typeof process !== 'undefined' && process.env.TRIAL_TUNNEL_URL) || '';
const TRIAL_API_KEY = (typeof process !== 'undefined' && process.env.TRIAL_API_KEY) || '';

const ALLOWED_ORIGINS = [
  'https://runonaspen.com',
  'https://www.runonaspen.com',
  'capacitor://localhost',
  'ionic://localhost',
];
function cors(origin) {
  const ok = ALLOWED_ORIGINS.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : 'https://runonaspen.com',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
function jsonErr(origin, msg, status, extra = {}) {
  return new Response(JSON.stringify({ error: msg, ...extra }), {
    status, headers: { ...cors(origin), 'Content-Type': 'application/json' },
  });
}

// ── Upstash Redis REST helpers (edge-safe) ───────────────
async function kv(command) {
  // command is an array, e.g. ['INCR', 'key']
  const res = await fetch(`${KV_URL}/${command.map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  if (!res.ok) throw new Error(`kv ${res.status}`);
  const data = await res.json();
  return data.result;
}
async function kvIncrWithTTL(key, ttl) {
  const n = await kv(['INCR', key]);
  if (n === 1) { try { await kv(['EXPIRE', key, String(ttl)]); } catch {} }
  return n;
}

function randToken() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}
function clientIp(req) {
  return (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
}

export default async function handler(req) {
  const origin = req.headers.get('origin') || '';
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== 'POST') return jsonErr(origin, 'POST only', 405);

  // If the trial isn't fully configured, fail CLOSED — never run uncapped.
  if (!KV_URL || !KV_TOKEN || !TRIAL_TUNNEL_URL) {
    return jsonErr(origin, 'Cloud trial is not available right now.', 503, { unavailable: true });
  }

  let body;
  try { body = await req.json(); } catch { return jsonErr(origin, 'Invalid JSON', 400); }
  const action = body.action || 'chat';
  const ip = clientIp(req);

  // ── action: start — issue a session token ──
  if (action === 'start') {
    try {
      // Per-IP daily ceiling check (don't issue if they've already burned the IP budget).
      const ipUsed = parseInt(await kv(['GET', `trial:ip:${ip}`]).catch(() => '0')) || 0;
      if (ipUsed >= MSGS_PER_IP_PER_DAY) {
        return jsonErr(origin, 'Trial limit reached for now. Download Aspen to keep going.', 429, { capped: true });
      }
      const token = randToken();
      await kv(['SET', `trial:sess:${token}`, '0']);
      await kv(['EXPIRE', `trial:sess:${token}`, String(SESSION_TTL_SEC)]);
      return new Response(JSON.stringify({ token, messagesLeft: MSGS_PER_SESSION }), {
        status: 200, headers: { ...cors(origin), 'Content-Type': 'application/json' },
      });
    } catch {
      return jsonErr(origin, 'Cloud trial is temporarily unavailable.', 503, { unavailable: true });
    }
  }

  // ── action: chat — counted, capped, proxied to the host machine ──
  const { token, messages, stream = true } = body;
  if (!token) return jsonErr(origin, 'Missing trial token. Start a trial first.', 400, { needStart: true });

  let sessionCount;
  try {
    const raw = await kv(['GET', `trial:sess:${token}`]);
    if (raw === null) return jsonErr(origin, 'Trial expired. Start a new one or download Aspen.', 401, { needStart: true });
    sessionCount = parseInt(raw) || 0;
  } catch {
    return jsonErr(origin, 'Cloud trial is temporarily unavailable.', 503, { unavailable: true });
  }

  // Session cap.
  if (sessionCount >= MSGS_PER_SESSION) {
    return jsonErr(origin, "You've used all 20 free cloud messages. Download Aspen to keep going — it's free and runs on your machine.", 429, { capped: true, messagesLeft: 0 });
  }

  // Global circuit breaker — protect the host machine from a traffic spike.
  try {
    const minuteBucket = Math.floor(Date.now() / 60000);
    const globalCount = await kvIncrWithTTL(`trial:global:${minuteBucket}`, 90);
    if (globalCount > GLOBAL_MAX_PER_MIN) {
      return jsonErr(origin, 'The cloud trial is busy right now. Try again in a minute, or download Aspen.', 503, { busy: true });
    }
  } catch { /* if breaker check fails, continue — session+IP caps still apply */ }

  // Count this message against session + IP BEFORE proxying (so a hang still counts).
  try {
    sessionCount = await kv(['INCR', `trial:sess:${token}`]);
    await kvIncrWithTTL(`trial:ip:${ip}`, IP_TTL_SEC);
    // Durable, monotonic all-time counter (never expires) — the reliable history.
    await kv(['INCR', 'aspen:trial_msgs_total']);
  } catch { /* best effort */ }

  // Proxy to the host machine's tunnel. Tolerate a TRIAL_TUNNEL_URL that already
  // ends in /v1 (otherwise we'd hit /v1/v1/chat/completions -> 404).
  const base = TRIAL_TUNNEL_URL.replace(/\/+$/, '').replace(/\/v1$/, '');
  const upstream = `${base}/v1/chat/completions`;
  const messagesLeft = Math.max(0, MSGS_PER_SESSION - sessionCount);

  // The host's Ollama requires an explicit model. We don't hardcode one — we ask
  // the host what it currently has and use the first (the host decides what's
  // loaded/best, so the model still "floats" with whatever the host runs).
  let trialModel = (typeof process !== 'undefined' && process.env.TRIAL_MODEL) || '';
  if (!trialModel) {
    try {
      const mRes = await fetch(`${base}/v1/models`, {
        headers: { ...(TRIAL_API_KEY ? { Authorization: `Bearer ${TRIAL_API_KEY}` } : {}) },
      });
      if (mRes.ok) {
        const list = (await mRes.json()).data || [];
        const pick = list.find((m) => !String(m.id).includes('embed'));
        if (pick) trialModel = pick.id;
      }
    } catch { /* fall through to graceful fail below */ }
  }
  if (!trialModel) {
    return jsonErr(origin, 'The cloud trial is unavailable right now. Download Aspen to run locally.', 503, { unavailable: true });
  }

  // Streaming with an immediate keep-alive (beats Vercel's 25s init deadline) +
  // graceful fail if the host machine is unreachable.
  const encoder = new TextEncoder();
  const streamBody = new ReadableStream({
    start(controller) {
      // start() must be synchronous (no await) or Vercel buffers the whole stream
      // until it resolves — same bug fixed in proxy.js. Flush immediately, pump in
      // a detached task. This is why messagesLeft + tokens stream live.
      controller.enqueue(encoder.encode(': connected\n\n'));
      controller.enqueue(encoder.encode(`: messagesLeft=${messagesLeft}\n\n`));
      let alive = true;
      const hb = setInterval(() => { if (alive) { try { controller.enqueue(encoder.encode(': keep-alive\n\n')); } catch {} } }, 8000);
      (async () => {
        try {
          const upRes = await fetch(upstream, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'Aspen-Trial/1.0', ...(TRIAL_API_KEY ? { Authorization: `Bearer ${TRIAL_API_KEY}` } : {}) },
            body: JSON.stringify({ model: trialModel, messages, stream: true }),
          });
          if (!upRes.ok || !upRes.body) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'The cloud trial is unavailable right now. Download Aspen to run locally.', unavailable: true })}\n\n`));
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            return;
          }
          const reader = upRes.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        } catch {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'The cloud trial is unavailable right now. Download Aspen to run locally.', unavailable: true })}\n\n`));
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          } catch {}
        } finally {
          alive = false; clearInterval(hb);
          try { controller.close(); } catch {}
        }
      })();
    },
  });

  return new Response(streamBody, {
    status: 200,
    headers: {
      ...cors(origin),
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
      'X-Trial-Messages-Left': String(messagesLeft),
    },
  });
}
