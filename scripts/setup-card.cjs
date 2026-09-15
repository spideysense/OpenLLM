// Factory/local administrator tool. Outputs a private printable card, never a
// credential in stdout or logs. Run with the unit's mounted encryption credential.
const fs = require('node:fs');
const QRCode = require('qrcode');
async function main() {
  const output = process.argv[2];
  if (!output) throw new Error('Usage: node scripts/setup-card.cjs /private/path/setup-card.html');
  if (!require('../src/main/service-key').provider()) throw new Error('Mount the appliance credential first');
  const state = require('../src/main/store').get('householdEnrollment');
  if (!state?.setup || state.enrolled) throw new Error('This unit is already enrolled. Use its recovery code; no setup card can be recreated.');
  if (!/^[a-f0-9]{12}$/.test(state.deviceId)) throw new Error('Invalid device identity');
  const address = `http://aspen-${state.deviceId}.local:4001`;
  const code = `aspen://pair#tunnel=${encodeURIComponent(address)}&setup=${encodeURIComponent(state.setup)}`;
  const svg = await QRCode.toString(code, { type: 'svg', errorCorrectionLevel: 'M', margin: 4 });
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Aspen setup card</title><style>body{font:18px system-ui;max-width:580px;margin:40px auto;color:#173c2a}svg{width:290px}code{overflow-wrap:anywhere;font-size:13px}li{margin:14px 0}@media print{body{margin:20mm}}</style><h1>Welcome home.</h1><ol><li>Connect Aspen to your router with the included Ethernet cable, then plug in power.</li><li>Connect your phone to your home Wi-Fi. Open the Aspen app and choose Connect → Scan QR code.</li><li>Scan this card, enter your name, and save your recovery code.</li></ol>${svg}<p>Device: aspen-${state.deviceId}</p><p>Manual address: <code>${address}</code></p><p>Setup code: <code>${state.setup}</code></p><p>Keep this card private until setup is complete. It works once. After setup, use the recovery code you saved to regain access.</p></html>`;
  const fd = fs.openSync(output, 'wx', 0o600);
  try { fs.writeFileSync(fd, html); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  console.log('Private setup card saved. Print locally and include with this device only.');
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { main };
