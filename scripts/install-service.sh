#!/usr/bin/env bash
# Run on a prepared Linux image after placing reviewed source in /opt/aspen.
set -euo pipefail
umask 077
test "$(id -u)" = 0 || { echo 'Run this installer as root on the appliance.'; exit 1; }
command -v systemd-creds >/dev/null
test -f /opt/aspen/src/main/service.js
test -x /usr/bin/node
/usr/bin/node -e 'if (+process.versions.node.split(".")[0] < 22) throw Error("Node 22 or newer required")'
getent group video >/dev/null || groupadd --system video
getent group render >/dev/null || groupadd --system render
id aspen >/dev/null 2>&1 || useradd --system --home-dir /var/lib/aspen --shell /usr/sbin/nologin aspen
install -d -m 0700 /etc/credstore.encrypted
if [ ! -f /etc/credstore.encrypted/aspen-key ]; then
  # Require TPM sealing, rather than a disk-resident unencrypted decryption key.
  head -c 32 /dev/urandom | systemd-creds encrypt --with-key=tpm2 --name=aspen-key - /etc/credstore.encrypted/aspen-key
fi
install -m 0644 /opt/aspen/scripts/aspen-service.service /etc/systemd/system/aspen.service
systemctl daemon-reload
systemctl enable --now aspen.service
echo 'Aspen starts at boot. Open http://localhost:4000/household on the appliance.'
echo 'Enroll each household after imaging. Never clone an enrolled device.'
