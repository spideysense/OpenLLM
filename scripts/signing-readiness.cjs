const fs = require('node:fs');
const platforms = {
  mac: ['MAC_CSC_LINK', 'MAC_CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'],
  windows: ['WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD'],
};
const result = Object.fromEntries(Object.entries(platforms).map(([platform, names]) => {
  const missing = names.filter(name => !process.env[name]);
  return [platform, { configured: missing.length === 0, missing }];
}));
fs.writeFileSync('signing-readiness.json', JSON.stringify(result, null, 2));
for (const [platform, value] of Object.entries(result)) console.log(`${platform}: ${value.configured ? 'credentials configured; signing validation still required' : 'missing ' + value.missing.join(', ')}`);
