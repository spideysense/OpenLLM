#!/usr/bin/env bash
#
# provision-appliance.sh — turn a fresh NVIDIA GB10 (DGX OS, arm64) box into an
# Aspen appliance: boot → full-screen Aspen → chat, with NOTHING to download or
# set up on first run. Run this ONCE on the box, verify, then clone the disk image.
#
# Idempotent: re-running skips work already done. Safe to resume after a failure.
#
# Override the model with:  ASPEN_MODEL=llama4:scout ./provision-appliance.sh
#
set -euo pipefail

# ── Config ─────────────────────────────────────────────────────────────────
MODEL="${ASPEN_MODEL:-gpt-oss:120b}"     # best open model that fits 128GB w/ headroom
ASPEN_DIR="$HOME/.aspen"                  # engine + models live here (matches the app)
BIN_DIR="$ASPEN_DIR/bin"                  # extracted ollama tree: bin/ollama + lib/ollama
MODELS_DIR="$ASPEN_DIR/models"
APP_DIR="${ASPEN_APP_DIR:-$HOME/aspen-app}"
REPO="https://github.com/spideysense/OpenLLM.git"
OLLAMA_URL="https://github.com/ollama/ollama/releases/latest/download/ollama-linux-arm64.tar.zst"
PORT=11434

say() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$1"; }

# ── 0. Sanity ──────────────────────────────────────────────────────────────
say "Checking machine"
arch="$(uname -m)"
[ "$arch" = "aarch64" ] || { echo "Expected aarch64 (GB10), got $arch. Aborting."; exit 1; }
ok "arch $arch"
command -v curl >/dev/null || { echo "curl required"; exit 1; }
command -v tar  >/dev/null || { echo "tar required";  exit 1; }
command -v node >/dev/null || { echo "Node.js required (install Node 20+ first)"; exit 1; }
command -v git  >/dev/null || { echo "git required"; exit 1; }
ok "curl / tar / node / git present"

# ── 1. Stage the AI engine (Ollama base arm64 + cuda_v13 libs) ──────────────
say "Staging AI engine"
OLLAMA_BIN="$BIN_DIR/bin/ollama"
if [ -x "$OLLAMA_BIN" ]; then
  ok "engine already staged ($OLLAMA_BIN)"
else
  mkdir -p "$BIN_DIR"
  tmp="$(mktemp -d)"
  echo "  downloading $(basename "$OLLAMA_URL") ..."
  curl -fL --retry 3 -o "$tmp/ollama.tar.zst" "$OLLAMA_URL"
  echo "  extracting (preserving bin/ + lib/ so CUDA libs resolve) ..."
  tar --zstd -xf "$tmp/ollama.tar.zst" -C "$BIN_DIR"
  rm -rf "$tmp"
  chmod +x "$OLLAMA_BIN"
  ok "engine staged at $OLLAMA_BIN"
fi

# ── 2. Start engine + pre-pull the model into the image ─────────────────────
say "Pre-pulling model: $MODEL  (one-time; large download)"
mkdir -p "$MODELS_DIR"
export OLLAMA_HOST="127.0.0.1:$PORT"
export OLLAMA_MODELS="$MODELS_DIR"

# Is an Ollama already serving on the port? If not, start our staged one.
STARTED_SERVER=0
if ! curl -sf "http://127.0.0.1:$PORT/api/version" >/dev/null 2>&1; then
  "$OLLAMA_BIN" serve >/tmp/aspen-provision-ollama.log 2>&1 &
  SERVER_PID=$!
  STARTED_SERVER=1
  echo "  waiting for engine to come up ..."
  for i in $(seq 1 30); do
    curl -sf "http://127.0.0.1:$PORT/api/version" >/dev/null 2>&1 && break
    sleep 1
  done
fi
curl -sf "http://127.0.0.1:$PORT/api/version" >/dev/null 2>&1 \
  || { echo "Engine failed to start. See /tmp/aspen-provision-ollama.log"; exit 1; }
ok "engine running on :$PORT"

if "$OLLAMA_BIN" list 2>/dev/null | awk '{print $1}' | grep -qx "$MODEL"; then
  ok "model $MODEL already present"
else
  echo "  pulling $MODEL ..."
  "$OLLAMA_BIN" pull "$MODEL"
  ok "model $MODEL pulled into $MODELS_DIR"
fi

# Stop the temp server we started (the app starts its own on boot)
if [ "$STARTED_SERVER" = "1" ]; then kill "${SERVER_PID:-0}" 2>/dev/null || true; fi

# ── 3. Make it the active model (so first boot is straight to chat) ──────────
say "Setting active model"
CFG_DIR="$HOME/.config/Aspen"
CFG="$CFG_DIR/config.json"
mkdir -p "$CFG_DIR"
if command -v node >/dev/null; then
  node -e '
    const fs=require("fs"),p=process.argv[1],m=process.argv[2];
    let o={}; try{o=JSON.parse(fs.readFileSync(p,"utf8"))}catch{}
    o.activeModel=m;
    fs.writeFileSync(p, JSON.stringify(o,null,2));
  ' "$CFG" "$MODEL"
  ok "activeModel = $MODEL ($CFG)"
fi

# ── 4. Install the Aspen app (from source) ──────────────────────────────────
say "Installing Aspen app"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only || true
else
  git clone "$REPO" "$APP_DIR"
fi
( cd "$APP_DIR" && npm ci && npm run build:renderer )
ELECTRON_BIN="$APP_DIR/node_modules/.bin/electron"
[ -x "$ELECTRON_BIN" ] || { echo "electron not found after npm ci"; exit 1; }
ok "app installed at $APP_DIR"

# ── 5. Autostart full-screen on login ───────────────────────────────────────
say "Registering autostart (kiosk)"
AUTODIR="$HOME/.config/autostart"
mkdir -p "$AUTODIR"
cat > "$AUTODIR/aspen.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Aspen
Comment=Private AI on your own hardware
Exec=sh -c 'cd "$APP_DIR" && ASPEN_KIOSK=1 "$ELECTRON_BIN" .'
X-GNOME-Autostart-enabled=true
Terminal=false
EOF
ok "autostart entry written ($AUTODIR/aspen.desktop)"

say "Done."
cat <<EOF

  Aspen appliance is provisioned:
    engine : $OLLAMA_BIN
    model  : $MODEL  (in $MODELS_DIR)
    app    : $APP_DIR  (autostarts full-screen on login)

  Verify now without rebooting:
    cd "$APP_DIR" && ASPEN_KIOSK=1 "$ELECTRON_BIN" .

  Then reboot to confirm it boots straight into Aspen, and clone the disk image.
EOF
