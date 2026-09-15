#!/usr/bin/env bash
# Run on a prepared Linux image after placing reviewed source in /opt/aspen.
set -euo pipefail
umask 077
test "$(id -u)" = 0 || { echo 'Run this installer as root on the appliance.'; exit 1; }
command -v systemd-creds >/dev/null
command -v avahi-daemon >/dev/null || { echo 'Install avahi-daemon for local discovery.'; exit 1; }
command -v hostnamectl >/dev/null
test -f /opt/aspen/src/main/service.js
NODE_BIN=/opt/aspen/runtime/node
test -x "$NODE_BIN"
"$NODE_BIN" -e 'const [major,minor]=process.versions.node.split(".").map(Number);if(major<22 || (major===22 && minor<12))throw Error("Node 22.12 or newer required")'
if [ ! -x /opt/aspen/vendor/ollama/bin/ollama ]; then
  "$NODE_BIN" /opt/aspen/scripts/install-engine.cjs
fi
getent group video >/dev/null || groupadd --system video
getent group render >/dev/null || groupadd --system render
id aspen >/dev/null 2>&1 || useradd --system --home-dir /var/lib/aspen --shell /usr/sbin/nologin aspen
install -d -m 0700 /etc/aspen
NEW_UNIT=0
if [ ! -f /etc/aspen/device-id ]; then
  test ! -f /var/lib/aspen/config.json || { echo 'Existing profile without unit identity. Migrate with a portable backup first.'; exit 1; }
  NEW_UNIT=1
  "$NODE_BIN" -e 'process.stdout.write(require("crypto").randomBytes(6).toString("hex"))' > /etc/aspen/device-id
fi
DEVICE_ID="$(cat /etc/aspen/device-id)"
[[ "$DEVICE_ID" =~ ^[a-f0-9]{12}$ ]] || { echo 'Invalid device identity'; exit 1; }
hostnamectl set-hostname "aspen-$DEVICE_ID"
printf 'ASPEN_DEVICE_ID=%s\nASPEN_LAN_PORT=4001\n' "$DEVICE_ID" > /etc/aspen/appliance.env
install -d -m 0700 /etc/credstore.encrypted
if [ ! -f /etc/credstore.encrypted/aspen-key ]; then
  # Require TPM sealing, rather than a disk-resident unencrypted decryption key.
  head -c 32 /dev/urandom | systemd-creds encrypt --with-key=tpm2 --name=aspen-key - /etc/credstore.encrypted/aspen-key
fi
install -m 0644 /opt/aspen/scripts/aspen-service.service /etc/systemd/system/aspen.service
systemctl daemon-reload
systemctl enable --now aspen.service
systemctl enable --now avahi-daemon.service
for attempt in $(seq 1 30); do
  test -f /var/lib/aspen/config.json && break
  sleep 1
done
if [ "$NEW_UNIT" = 1 ]; then
systemd-run --wait --pipe --collect --unit=aspen-setup-card \
  -p User=aspen \
  -p LoadCredentialEncrypted=aspen-key:/etc/credstore.encrypted/aspen-key \
  -p 'Environment=ASPEN_DATA_DIR=/var/lib/aspen ASPEN_KEY_FILE=%d/aspen-key' \
  "$NODE_BIN" /opt/aspen/scripts/setup-card.cjs /var/lib/aspen/setup-card.html
fi
echo 'Aspen starts at boot. Generate the private setup card under the mounted service credential.'
echo 'The phone app connects on the home network; only encrypted requests are exposed on port 4001.'
echo 'Enroll each household after imaging. Never clone an enrolled device.'
