#!/usr/bin/env bash
# Prepare a supported Linux desktop image. Does not enroll household credentials.
# Requires a graphical login session for Electron; this is not a headless daemon.
# ASPEN_REF can pin a reviewed release commit; ASPEN_MODEL overrides the shared recommendation.
set -euo pipefail
umask 077
ASPEN_DIR="$HOME/.aspen"
APP_DIR="${ASPEN_APP_DIR:-$HOME/aspen-app}"
BIN_DIR="$ASPEN_DIR/bin"
MODELS_DIR="$ASPEN_DIR/models"
REPO="https://github.com/spideysense/OpenLLM.git"
PORT=11434
say() { printf '\n%s\n' "$1"; }
case "$(uname -m)" in
  aarch64) ENGINE_ARCH=arm64 ;;
  x86_64) ENGINE_ARCH=amd64 ;;
  *) echo 'Supported architectures: arm64 and x86_64'; exit 1 ;;
esac
for dependency in curl tar git node npm; do
  command -v "$dependency" >/dev/null || { echo "Install $dependency before provisioning."; exit 1; }
done
node -e 'if(Number(process.versions.node.split(".")[0]) < 22) throw Error("Node 22 or newer is required")'

say 'Installing the reviewed application source'
if [ ! -d "$APP_DIR/.git" ]; then git clone "$REPO" "$APP_DIR"; fi
if [ -n "${ASPEN_REF:-}" ]; then
  if [ -n "$(git -C "$APP_DIR" status --porcelain)" ]; then echo 'Application checkout has local changes; preserve them before selecting a release.'; exit 1; fi
  git -C "$APP_DIR" fetch origin "$ASPEN_REF"
  git -C "$APP_DIR" checkout --detach FETCH_HEAD
fi
( cd "$APP_DIR" && npm ci && npm run build:renderer )
ELECTRON_BIN="$APP_DIR/node_modules/.bin/electron"
[ -x "$ELECTRON_BIN" ] || { echo 'Electron installation failed'; exit 1; }

# The exact same catalog, hardware detector, and memory budget as desktop onboarding.
MODEL="${ASPEN_MODEL:-}"
if [ -z "$MODEL" ]; then
  MODEL="$(cd "$APP_DIR" && node -e '
    const system=require("./src/main/system"),models=require("./src/main/models");
    const selected=models.getRecommendation(system.getHardwareTier(),require("./registry/models.json"),system.getRuntimeBudget());
    if(!selected) throw Error("No supported model fits this device");
    process.stdout.write(selected.model);
  ')"
fi

say 'Staging the AI engine'
OLLAMA_BIN="$BIN_DIR/bin/ollama"
if [ ! -x "$OLLAMA_BIN" ]; then
  staging="$(mktemp -d)"
  trap 'rm -rf "${staging:-}"' EXIT
  OLLAMA_URL="https://github.com/ollama/ollama/releases/latest/download/ollama-linux-${ENGINE_ARCH}.tar.zst"
  curl -fL --retry 3 -o "$staging/ollama.tar.zst" "$OLLAMA_URL"
  mkdir -p "$BIN_DIR"
  tar --zstd -xf "$staging/ollama.tar.zst" -C "$BIN_DIR"
  test -x "$OLLAMA_BIN"
  rm -rf "$staging"
fi
mkdir -p "$MODELS_DIR"
export OLLAMA_HOST="127.0.0.1:$PORT" OLLAMA_MODELS="$MODELS_DIR"
# Factory qualification runs a single model. Normal runtime applies its own budget.
export OLLAMA_NUM_PARALLEL=1 OLLAMA_MAX_LOADED_MODELS=1
SERVER_PID=''
cleanup() { if [ -n "$SERVER_PID" ]; then kill "$SERVER_PID" 2>/dev/null || true; fi; }
trap cleanup EXIT
# Never accidentally install into somebody else's running engine/model directory.
if curl -sf "$OLLAMA_HOST/api/version" >/dev/null; then
  echo 'Stop the existing AI engine before provisioning so its storage is not modified.'; exit 1
fi
"$OLLAMA_BIN" serve >"$ASPEN_DIR/provision-engine.log" 2>&1 &
SERVER_PID=$!
for attempt in $(seq 1 30); do
  if curl -sf "$OLLAMA_HOST/api/version" >/dev/null; then break; fi
  sleep 1
done
curl -sf "$OLLAMA_HOST/api/version" >/dev/null || { echo "Engine failed; see $ASPEN_DIR/provision-engine.log"; exit 1; }

say "Downloading and qualifying $MODEL"
"$OLLAMA_BIN" pull "$MODEL"
( cd "$APP_DIR" && node - "$MODEL" <<'NODE'
const model=process.argv[2];
(async()=>{
  const checked=await require('./src/main/model-qualification').qualify(model);
  if(!checked.ok || !checked.tools) throw Error(checked.error || 'Model does not support household tools');
  const store=require('./src/main/store');
  store.set('activeModel',model);
  store.set('onboarded',true);
  store.set('leanMode',false);
  store.set('autoRetireModels',false);
})().catch(error=>{console.error(error.message);process.exitCode=1});
NODE
)
cleanup
SERVER_PID=''

say 'Registering the desktop appliance session'
AUTODIR="$HOME/.config/autostart"
mkdir -p "$AUTODIR"
cat > "$AUTODIR/aspen.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Aspen
Comment=Private AI on your hardware
Exec=env ASPEN_PROD=1 ASPEN_KIOSK=1 "$ELECTRON_BIN" "$APP_DIR"
X-GNOME-Autostart-enabled=true
Terminal=false
DESKTOP
cat <<DONE
Provisioned model: $MODEL
Application: $APP_DIR
The app starts at graphical login and remains available after its window closes.
Verify first chat, reboot, network loss, and recovery on this image before shipping.
Create the factory image BEFORE enrolling a household or generating pairing keys.
DONE
