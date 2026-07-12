/**
 * Privacy-safe funnel counters. Increments a per-event total + per-day count in
 * Upstash Redis. NEVER stores conversation content — only that an event happened.
 * No-ops silently if Upstash isn't configured, and never throws into the caller.
 *
 * Vercel env (optional): UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
 * Events are things that already touch our server by design:
 *   trial_started, box_provisioned, feedback_partial, feedback_complete, preorder
 */
export async function track(event, n = 1) {
  const url = process.env.KV_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token || !event) return;
  const safe = String(event).replace(/[^a-z0-9_]/gi, '_').slice(0, 40);
  const day = new Date().toISOString().slice(0, 10);
  const keys = [`aspen:ct:${safe}`, `aspen:ct:${safe}:${day}`];
  try {
    await Promise.all(
      keys.map((k) =>
        fetch(`${url}/incrby/${encodeURIComponent(k)}/${n}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      )
    );
  } catch {
    /* analytics must never break the actual request */
  }
}
