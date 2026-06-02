/**
 * electron-builder afterAllArtifactBuild hook.
 *
 * Root-cause fix: electron-builder notarizes the .app but NOT the .dmg wrapper,
 * so fresh DMG downloads hit "Aspen is damaged" (no stapled ticket). This hook
 * runs after artifacts are built: it submits each .dmg to Apple's notary service
 * and staples the ticket, so website downloads open cleanly with no manual steps.
 */
const { execSync } = require('child_process');

exports.default = async function afterAllArtifactBuild(context) {
  const artifacts = context.artifactPaths || [];
  const dmgs = artifacts.filter((p) => p.endsWith('.dmg'));

  if (dmgs.length === 0) return [];

  const appleId = process.env.APPLE_ID;
  const password = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !password || !teamId) {
    throw new Error(
      '[staple-dmg] FATAL: Missing APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID. ' +
      'The DMG would ship UN-STAPLED and users get "Aspen is damaged". ' +
      'Set these env vars before building (see scripts/release-mac.js). Refusing to ship a broken DMG.'
    );
  }

  for (const dmg of dmgs) {
    console.log(`[staple-dmg] Notarizing DMG: ${dmg}`);
    execSync(
      `xcrun notarytool submit "${dmg}" --apple-id "${appleId}" --password "${password}" --team-id "${teamId}" --wait`,
      { stdio: 'inherit' }
    );
    console.log(`[staple-dmg] Stapling: ${dmg}`);
    execSync(`xcrun stapler staple "${dmg}"`, { stdio: 'inherit' });
    // Verify the ticket actually attached — fail loudly if not.
    console.log(`[staple-dmg] Validating staple: ${dmg}`);
    execSync(`xcrun stapler validate "${dmg}"`, { stdio: 'inherit' });
    console.log(`[staple-dmg] Done (validated): ${dmg}`);
  }

  return [];
};
