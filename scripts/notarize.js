const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== 'darwin') return;

  // Skip if no Apple credentials (local dev builds)
  if (!process.env.APPLE_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD) {
    console.log('⚠️  Skipping notarization — no Apple credentials set.');
    console.log('   Set APPLE_ID and APPLE_APP_SPECIFIC_PASSWORD to notarize.');
    console.log('   Users can still open unsigned builds: right-click → Open');
    return;
  }

  const appName = context.packager.appInfo.productFilename;

  console.log(`🔏 Notarizing ${appName}...`);

  await notarize({
    appBundleId: 'com.llmbear.app',
    appPath: `${appOutDir}/${appName}.app`,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  });

  console.log(`✅ Notarization complete`);
};
