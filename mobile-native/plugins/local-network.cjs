const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');
module.exports = function localNetwork(config) {
  config = withAndroidManifest(config, cfg => {
    cfg.modResults.manifest.application[0].$['android:networkSecurityConfig'] = '@xml/aspen_network_security';
    return cfg;
  });
  return withDangerousMod(config, ['android', async cfg => {
    const dir = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/res/xml');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'aspen_network_security.xml'), `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="true">local</domain>
  </domain-config>
</network-security-config>\n`);
    return cfg;
  }]);
};
