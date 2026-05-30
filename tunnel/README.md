# Aspen Tunnel — Permanent URLs

Gives every user a **permanent, free** public HTTPS URL for their local AI using Cloudflare Named Tunnels.

**Cost: $0 to the user. No Cloudflare account. No configuration.**

## How It Works

```
First launch (one-time):
    App downloads `cloudflared` binary (~30MB)
        ↓
    App calls Aspen provisioning API
        ↓
    API creates a Cloudflare named tunnel + DNS record
        ↓
    Returns tunnel token + permanent URL
        ↓
    App stores token locally

Every launch:
    App runs: cloudflared tunnel run --token <TOKEN>
        ↓
    Permanent URL is live: https://a1b2c3d4.runonaspen.com/v1
```

From the user's perspective:
1. Open Aspen
2. See "Your API: `https://a1b2c3d4.runonaspen.com/v1`" — **same URL forever**
3. Paste into Cursor, Zapier, Replit, phone — anything
4. Models run on their hardware. Cloudflare routes the traffic.

## Architecture

### Provisioning API (`site/api/tunnel-provision.js`)

Vercel serverless function that runs on Aspen's Cloudflare account:
- Creates a named tunnel via Cloudflare API
- Configures ingress: `<subdomain>.runonaspen.com` → `http://localhost:4000`
- Creates DNS CNAME record
- Returns tunnel token + stable URL

Called once per user, on first launch. Requires these Vercel env vars:
- `CF_API_TOKEN` — Cloudflare API token (Tunnel Edit + DNS Edit)
- `CF_ACCOUNT_ID` — Cloudflare account ID
- `CF_ZONE_ID` — Cloudflare zone ID
- `CF_TUNNEL_DOMAIN` — Domain (e.g. `runonaspen.com`)
- `PROVISION_SECRET` — Shared secret for app authentication

### Tunnel Client (`src/main/tunnel.js`)

Embedded in the Electron main process:
- **First launch**: calls provisioning API, stores token + URL in electron-store
- **Every launch**: runs `cloudflared tunnel run --token <TOKEN>`
- **Auto-reconnects** with exponential backoff (5s → 60s max)
- **Auth error recovery**: if token is invalid, clears stored credentials and re-provisions

### Why Named Tunnels?

| Feature | Quick Tunnel (old) | Named Tunnel (new) |
|---------|-------------------|-------------------|
| URL stability | Changes every restart | **Permanent** |
| User account needed | No | No |
| Cost | Free | Free |
| Reliability | Sometimes drops | Managed by Cloudflare |
| Setup | Zero | Zero (provisioning is automatic) |

### Limits

- 1,000 tunnels per Cloudflare account (free tier)
- No bandwidth limits
- No request limits

## IPC Bridge

```javascript
const { connected, url } = await window.aspen.tunnel.getStatus();
await window.aspen.tunnel.copyUrl();    // copies URL + /v1 to clipboard
await window.aspen.tunnel.restart();
const unsub = window.aspen.tunnel.onStatus((s) => { /* s.status, s.url */ });
```

## Status Flow

```
downloading → provisioning → connecting → connected → (disconnected → reconnecting → connected)
```

## License

MIT
