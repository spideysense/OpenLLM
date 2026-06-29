#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Aspen · SearXNG setup (private metasearch backend for web_search)
#
# Stands up a self-hosted SearXNG container on the box:
#   • JSON API enabled (off by default — without it the API returns 403)
#   • limiter disabled (bot-detection; would block our own localhost API calls)
#   • bound to 127.0.0.1 only (never exposed to the network)
#   • random secret_key generated locally (no secret written by hand)
#
# Idempotent: re-running recreates the container with the same settings.
# Multi-arch image — works on the GB10's arm64.
#
# Usage:  bash scripts/setup-searxng.sh
# Then:   add SEARXNG_URL=http://127.0.0.1:8888 to the gateway env and restart.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PORT="${SEARXNG_PORT:-8888}"
DIR="${SEARXNG_DIR:-$HOME/aspen-searxng}"
NAME="aspen-searxng"
IMAGE="searxng/searxng:latest"

echo "▶ SearXNG → 127.0.0.1:${PORT}  (config: ${DIR})"

if ! command -v docker >/dev/null 2>&1; then
  echo "✗ docker not found. Install Docker first, then re-run." >&2
  exit 1
fi

mkdir -p "$DIR"

# settings.yml — layered on top of SearXNG's defaults so we inherit all engines.
SECRET="$(openssl rand -hex 32 2>/dev/null || head -c32 /dev/urandom | xxd -p -c32)"
cat > "$DIR/settings.yml" <<YAML
use_default_settings: true
server:
  secret_key: "${SECRET}"
  bind_address: "0.0.0.0"
  limiter: false          # off: bot-detection would block our own API calls
  public_instance: false
search:
  safe_search: 0
  formats:
    - html
    - json                # required for the /search?format=json API (else 403)
YAML
echo "✓ wrote ${DIR}/settings.yml (random secret_key generated locally)"

# Recreate cleanly.
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker pull "$IMAGE"
docker run -d --name "$NAME" --restart unless-stopped \
  -p "127.0.0.1:${PORT}:8080" \
  -v "$DIR/settings.yml:/etc/searxng/settings.yml:ro" \
  "$IMAGE" >/dev/null
echo "✓ container started"

# Self-test: poll the JSON API until it answers (cold start takes a few seconds).
echo -n "▶ verifying JSON API "
ok=""
for i in $(seq 1 20); do
  echo -n "."
  body="$(curl -s "http://127.0.0.1:${PORT}/search?q=aspen+test&format=json" 2>/dev/null || true)"
  if echo "$body" | grep -q '"results"'; then ok=1; break; fi
  sleep 2
done
echo ""
if [ -n "$ok" ]; then
  n="$(echo "$body" | grep -o '"url"' | wc -l | tr -d ' ')"
  echo "✓ JSON API live — sample query returned ${n} results"
  echo ""
  echo "NEXT:"
  echo "  1) Add to the gateway env:   SEARXNG_URL=http://127.0.0.1:${PORT}"
  echo "  2) Restart the app:          cd ~/aspen-app && git pull origin main && npm run dev"
  echo "  3) Ask any web question — box log should show [TOOLDBG] ok: web_search (2000+ chars)"
else
  echo "✗ JSON API did not respond. Check: docker logs ${NAME}" >&2
  exit 1
fi
