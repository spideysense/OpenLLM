# LLM Bear Tunnel

Gives every user a free public URL for their local AI using Cloudflare Quick Tunnels.

**Cost: $0. No relay server. No Cloudflare account. No infrastructure.**

## How It Works

```
Open LLM Bear
    ↓
App downloads `cloudflared` binary (one-time, ~30MB)
    ↓
Runs: cloudflared tunnel --url http://localhost:4000
    ↓
Cloudflare assigns: https://abc-xyz.trycloudflare.com
    ↓
That URL routes to your local AI from anywhere in the world
```

From the user's perspective:
1. Open LLM Bear
2. See "Your API: `https://abc-xyz.trycloudflare.com/v1`"
3. Paste into Cursor, Zapier, Replit, phone — anything
4. Models run on their hardware. Cloudflare just routes the traffic.

## Architecture

### Tunnel Client (`src/main/tunnel.js`)

Embedded in the Electron main process:

- **Auto-downloads** `cloudflared` binary to `~/.llmbear/bin/` on first run
- **Supports** macOS (universal), Windows (amd64), Linux (amd64/arm64)
- **Spawns** `cloudflared tunnel --url http://localhost:4000 --no-autoupdate`
- **Parses** the assigned URL from cloudflared's stderr output
- **Auto-reconnects** with exponential backoff (5s → 60s max)
- **Notifies** renderer via IPC so the UI shows the URL
- **Persists** last known URL in electron-store

### No Server Required

Unlike ngrok or custom relay servers, Cloudflare Quick Tunnels are:
- Completely free with no account
- No usage limits for personal use
- TLS encrypted automatically
- Routed through Cloudflare's global network (fast everywhere)

The only downside: URL changes on each restart. For stable URLs, users
can create a free Cloudflare account and use named tunnels, but the
quick tunnel works great for most use cases.

## IPC Bridge

```javascript
const { connected, url } = await window.llmbear.tunnel.getStatus();
await window.llmbear.tunnel.copyUrl();    // copies URL + /v1 to clipboard
await window.llmbear.tunnel.restart();
const unsub = window.llmbear.tunnel.onStatus((s) => { /* s.status, s.url */ });
```

## Status Flow

```
downloading → connecting → connected → (disconnected → reconnecting → connected)
```

## License

MIT
