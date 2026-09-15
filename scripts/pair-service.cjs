// Run locally as the service user, with the same systemd credential, to display
// the initial owner pairing. This never writes or rotates household identities.
const keys = require('../src/main/apikeys').listKeys();
const owner = keys.find(k => k.owner);
if (!owner) throw new Error('Start the household service before pairing.');
if (!process.stdout.isTTY) throw new Error('Owner pairing can only be displayed in a local terminal; do not redirect it into logs.');
console.log('Pairing credential for the household owner. Keep it private:');
console.log(owner.secret);
