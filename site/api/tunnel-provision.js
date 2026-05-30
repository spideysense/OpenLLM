/**
 * Tunnel Provisioning API
 *
 * Creates a permanent Cloudflare named tunnel for each Aspen user.
 * On first launch, the Aspen app calls this endpoint once. It returns
 * a tunnel token + stable URL that never changes.
 *
 * How it works:
 * 1. Creates a Cloudflare named tunnel via API (on Aspen's CF account)
 * 2. Configures ingress: subdomain → http://localhost:4000
 * 3. Creates a DNS CNAME: <id>.runonaspen.com → <tunnel-id>.cfargotunnel.com
 * 4. Returns the tunnel token to the Aspen app
 *
 * The app stores the token locally and runs:
 *   cloudflared tunnel run --token <TOKEN>
 *
 * Cost: $0. Cloudflare Tunnels are free. 1000 tunnels per account.
 *
 * Vercel env vars needed:
 *   CF_API_TOKEN    — Cloudflare API token (Tunnel Edit + DNS Edit)
 *   CF_ACCOUNT_ID   — Cloudflare account ID
 *   CF_ZONE_ID      — Cloudflare zone ID for the domain
 *   CF_TUNNEL_DOMAIN — Domain to use (e.g. runonaspen.com)
 *   PROVISION_SECRET — Shared secret so only the Aspen app can call this
 */

const CF_API = 'https://api.cloudflare.com/client/v4';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Verify the request is from a Aspen app
  const secret = req.headers['x-aspen-secret'] || req.body?.secret;
  if (!secret || secret !== process.env.PROVISION_SECRET) {
    return res.status(401).json({ error: 'Invalid provision secret' });
  }

  const CF_TOKEN = process.env.CF_API_TOKEN;
  const ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
  const ZONE_ID = process.env.CF_ZONE_ID;
  const DOMAIN = process.env.CF_TUNNEL_DOMAIN;

  if (!CF_TOKEN || !ACCOUNT_ID || !ZONE_ID || !DOMAIN) {
    return res.status(500).json({ error: 'Server misconfigured — missing Cloudflare env vars' });
  }

  // Generate a short unique subdomain for this user
  const subdomain = generateSubdomain();
  const hostname = `${subdomain}.${DOMAIN}`;
  const tunnelName = `aspen-${subdomain}`;

  try {
    // ── Step 1: Create the tunnel ──
    const tunnelRes = await cfFetch(`/accounts/${ACCOUNT_ID}/cfd_tunnel`, {
      method: 'POST',
      body: { name: tunnelName, config_src: 'cloudflare' },
    }, CF_TOKEN);

    if (!tunnelRes.success) {
      console.error('Tunnel creation failed:', tunnelRes.errors);
      return res.status(502).json({ error: 'Tunnel creation failed', detail: tunnelRes.errors });
    }

    const tunnelId = tunnelRes.result.id;
    const tunnelToken = tunnelRes.result.token;

    // ── Step 2: Configure ingress (route subdomain → localhost:4000) ──
    const configRes = await cfFetch(`/accounts/${ACCOUNT_ID}/cfd_tunnel/${tunnelId}/configurations`, {
      method: 'PUT',
      body: {
        config: {
          ingress: [
            {
              hostname: hostname,
              service: 'http://localhost:4000',
              originRequest: {},
            },
            { service: 'http_status:404' },
          ],
        },
      },
    }, CF_TOKEN);

    if (!configRes.success) {
      console.error('Tunnel config failed:', configRes.errors);
      // Clean up: delete the tunnel we just created
      await cfFetch(`/accounts/${ACCOUNT_ID}/cfd_tunnel/${tunnelId}`, { method: 'DELETE' }, CF_TOKEN).catch(() => {});
      return res.status(502).json({ error: 'Tunnel configuration failed', detail: configRes.errors });
    }

    // ── Step 3: Create DNS CNAME record ──
    const dnsRes = await cfFetch(`/zones/${ZONE_ID}/dns_records`, {
      method: 'POST',
      body: {
        type: 'CNAME',
        proxied: true,
        name: hostname,
        content: `${tunnelId}.cfargotunnel.com`,
      },
    }, CF_TOKEN);

    if (!dnsRes.success) {
      console.error('DNS creation failed:', dnsRes.errors);
      // Clean up tunnel
      await cfFetch(`/accounts/${ACCOUNT_ID}/cfd_tunnel/${tunnelId}`, { method: 'DELETE' }, CF_TOKEN).catch(() => {});
      return res.status(502).json({ error: 'DNS record creation failed', detail: dnsRes.errors });
    }

    // ── Done! Return token + stable URL ──
    return res.status(200).json({
      tunnelId,
      token: tunnelToken,
      url: `https://${hostname}`,
      hostname,
      message: 'Tunnel provisioned. Run: cloudflared tunnel run --token <TOKEN>',
    });
  } catch (err) {
    console.error('Provision error:', err);
    return res.status(500).json({ error: 'Provisioning failed', detail: err.message });
  }
}

// ═══════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════

async function cfFetch(path, options, token) {
  const url = `${CF_API}${path}`;
  const resp = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return resp.json();
}

function generateSubdomain() {
  // 8 chars, alphanumeric, URL-safe — 2.8 trillion combinations
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars[bytes[i] % chars.length];
  }
  return id;
}
