# LLM Bear Tunnel

Gives every LLM Bear user a public URL for their local AI. Models run on the user's machine, but the URL works from anywhere — their phone, Zapier, Replit, another computer.

## How It Works

```
Internet request → https://abc123.api.llmbear.com/v1/chat/completions
                       ↓
              Tunnel Relay Server (Fly.io)
              Extracts subdomain "abc123"
              Looks up WebSocket for that subdomain
                       ↓
              WebSocket → User's LLM Bear App
                       ↓
              localhost:4000 → Ollama → Response
                       ↓
              WebSocket back to relay → HTTP response to caller
```

**From the user's perspective:**
1. Open LLM Bear
2. See "Your API: `https://abc123.api.llmbear.com/v1`" in the app
3. Paste that URL into Cursor, Zapier, Replit, or any OpenAI-compatible tool
4. Everything runs on their hardware — the relay only routes traffic

## Architecture

### Relay Server (`tunnel/relay/`)

Lightweight Node.js + ws server deployed on Fly.io. Handles:

- **WebSocket connections** from desktop clients at `wss://api.llmbear.com/tunnel`
- **HTTP proxy** — extracts subdomain from Host header, forwards request to the right WS client
- **Subdomain assignment** — each client gets a random 8-char hex subdomain
- **Reconnect stability** — tunnel keys let clients reclaim their subdomain after reconnect
- **Registration** — pre-assign subdomain via POST /register
- **Heartbeat** — ping/pong to keep WebSocket alive through proxies/firewalls
- **CORS** — full preflight handling for browser-based API calls

### Tunnel Client (`src/main/tunnel.js`)

Embedded in the Electron main process. On app start:

1. Connects to `wss://api.llmbear.com/tunnel`
2. Sends tunnel key (persisted in electron-store) for subdomain stability
3. Receives `assigned` message with public URL
4. Pushes status to renderer via IPC (`tunnel:status`)
5. Receives HTTP requests from relay, forwards to `localhost:4000`
6. Sends responses back through WebSocket

Features:
- Auto-reconnect with exponential backoff (3s → 30s max)
- 25s heartbeat to keep connection alive
- 2-minute timeout for LLM responses
- Clean shutdown (no reconnect on quit)
- Status callbacks: connecting → connected → disconnected → reconnecting

## Deploy Relay

```bash
cd tunnel/relay
fly launch --name llmbear-tunnel
fly deploy
```

### DNS Setup

Point `*.api.llmbear.com` at the Fly.io app:

```
*.api.llmbear.com  CNAME  llmbear-tunnel.fly.dev
```

Fly.io handles wildcard TLS certificates automatically.

## IPC Bridge

The renderer can access tunnel state via:

```javascript
// Get current status
const { connected, url, subdomain } = await window.llmbear.tunnel.getStatus();

// Copy URL to clipboard
await window.llmbear.tunnel.copyUrl();

// Listen for status changes
const unsub = window.llmbear.tunnel.onStatus((status) => {
  // status = { status: 'connected', url: 'https://abc123.api.llmbear.com', subdomain: 'abc123' }
});

// Restart tunnel
await window.llmbear.tunnel.restart();
```

## Security

- WebSocket connections use `wss://` (TLS encrypted)
- Tunnel keys are cryptographically random and stored locally
- Subdomain assignment is random (8 hex chars = 4 billion combinations)
- The relay never stores request/response content — it's a pass-through
- Forwarding headers (`x-forwarded-for`, `host`) are stripped before reaching local API
- The relay adds `X-Powered-By: LLM Bear Tunnel` but no user-identifying info

## License

MIT
