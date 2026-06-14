#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
#  Aspen installer — private AI that runs on your own machine
#  Usage:  curl -fsSL https://runonaspen.com/install.sh | sh
# ═══════════════════════════════════════════════════════════
set -e

REPO="spideysense/OpenLLM"
APP="Aspen"

# ── pretty output ──
bold()  { printf "\033[1m%s\033[0m\n" "$1"; }
info()  { printf "  \033[36m→\033[0m %s\n" "$1"; }
ok()    { printf "  \033[32m✓\033[0m %s\n" "$1"; }
err()   { printf "  \033[31m✗\033[0m %s\n" "$1" >&2; }

echo ""
bold "Installing Aspen"
echo ""

# ── 1. Detect architecture ──
ARCH="$(uname -m)"
case "$ARCH" in
  aarch64|arm64) DEB_ARCH="arm64" ;;
  x86_64|amd64)  DEB_ARCH="amd64" ;;
  *) err "Unsupported architecture: $ARCH"; exit 1 ;;
esac
info "Architecture: $DEB_ARCH"

# ── 2. Make sure we're on a Debian/Ubuntu system (has dpkg) ──
if ! command -v dpkg >/dev/null 2>&1; then
  err "This installer needs a Debian/Ubuntu-based system (dpkg not found)."
  info "Download the AppImage instead: https://runonaspen.com"
  exit 1
fi

# ── 3. Pick a sudo command if we're not root ──
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  else
    err "Need root to install. Re-run as root or install sudo."
    exit 1
  fi
fi

# ── 4. Download the latest .deb ──
DEB_URL="https://github.com/${REPO}/releases/latest/download/Aspen-linux-${DEB_ARCH}.deb"
TMP_DEB="$(mktemp /tmp/aspen-XXXXXX.deb)"
info "Downloading the latest release…"
if ! curl -fsSL "$DEB_URL" -o "$TMP_DEB"; then
  err "Download failed from $DEB_URL"
  rm -f "$TMP_DEB"
  exit 1
fi
ok "Downloaded ($(du -h "$TMP_DEB" | cut -f1))"

# ── 5. Install with dependency resolution ──
info "Installing (you may be asked for your password)…"
if command -v apt >/dev/null 2>&1; then
  # apt resolves dependencies automatically
  $SUDO apt install -y "$TMP_DEB" >/dev/null 2>&1 || $SUDO apt install -y "$TMP_DEB"
else
  # fallback: dpkg then fix deps
  $SUDO dpkg -i "$TMP_DEB" || $SUDO apt-get install -fy
fi
rm -f "$TMP_DEB"
ok "Installed"

echo ""
bold "Aspen is ready."
echo ""
info "Launch it from your apps menu, or run: aspen"
echo ""
