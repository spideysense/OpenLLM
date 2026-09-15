const fs = require('fs');
for (const target of ['site/secure-fetch.js', 'mobile/www/secure-fetch.js', 'mobile-native/src/secure-fetch.js']) fs.copyFileSync('shared/secure-fetch.js', target);
