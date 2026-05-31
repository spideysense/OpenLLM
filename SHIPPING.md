# Shipping Aspen — Desktop DMG + iOS + Android

Everything you need to ship all three. The code is done. What's left is
accounts, credentials, and running the build commands. Work top to bottom.

═══════════════════════════════════════════════════════════════
PART 1 — DESKTOP DMG (the primary product)
═══════════════════════════════════════════════════════════════

## 1a. One-time: Apple Developer account
- Go to https://developer.apple.com/programs/ → Enroll ($99/year)
- Takes ~24-48h to approve. Needed to sign + notarize the DMG so users
  don't get "unidentified developer" warnings.
- (You CAN ship an unsigned DMG today without this — users right-click → Open
  the first time. The build already handles this gracefully.)

## 1b. One-time: Create an app-specific password
Once your Developer account is active:
1. Go to https://account.apple.com → Sign-In and Security → App-Specific Passwords
2. Click "+", name it "Aspen Notarization", copy the password (looks like xxxx-xxxx-xxxx-xxxx)

## 1c. One-time: Find your Team ID
- https://developer.apple.com/account → Membership Details → copy "Team ID" (10 chars)

## 1d. Build the DMG
In Terminal, from the aspen folder:
```bash
# Set credentials (paste your real values)
export APPLE_ID="your-apple-email@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="YOURTEAMID"
export GH_TOKEN="your-github-token"   # for auto-publishing the release

# Build, sign, notarize, and publish to GitHub releases
npm install
npm run build:mac
```
This produces `dist/Aspen-mac.dmg` AND publishes it to your GitHub releases,
which is what runonaspen.com/download points to.

**No Apple account yet?** Just run `npm run build:mac` without the export lines.
You get an unsigned `dist/Aspen-mac.dmg` you can share directly. It works; users
right-click → Open the first time.

## 1e. GitHub token (for auto-publish)
- https://github.com/settings/tokens → Generate new token (classic)
- Check the "repo" scope → generate → copy → use as GH_TOKEN above

═══════════════════════════════════════════════════════════════
PART 2 — iOS APP
═══════════════════════════════════════════════════════════════

## 2a. One-time: same Apple Developer account as above ($99/yr covers both)

## 2b. Build & submit
```bash
cd mobile
npm install
npx cap sync ios
npx cap open ios     # opens Xcode
```
In Xcode:
1. Click "App" in the left sidebar → "Signing & Capabilities" tab
2. Check "Automatically manage signing" → select your Team from dropdown
3. If "com.runonaspen.app" is taken, change the Bundle Identifier to something
   unique like "com.yourname.aspen"
4. Plug in your iPhone (or pick a simulator) → press the ▶ Play button to test
5. To submit to App Store:
   - Top menu: Product → Archive (build a real device archive first; select
     "Any iOS Device" as the target, not a simulator)
   - When done, the Organizer window opens → "Distribute App" → "App Store Connect"
   - Follow prompts to upload

## 2c. One-time: App Store Connect listing
- https://appstoreconnect.apple.com → My Apps → "+" → New App
- Fill in: name (Aspen), bundle ID (match Xcode), SKU (any unique string)
- Add: screenshots (6.7" iPhone required), description, privacy policy URL,
  category (Productivity or Developer Tools)
- IMPORTANT for review: in "App Review Information" notes, explain Aspen is a
  companion to the free Mac app and give reviewers a demo tunnel URL + API key,
  OR attach a screen recording of pairing. Otherwise they can't test it and
  will reject.

═══════════════════════════════════════════════════════════════
PART 3 — ANDROID APP
═══════════════════════════════════════════════════════════════

## 3a. One-time: Google Play Console account ($25, one-time, ~1-2 day approval)
- https://play.google.com/console/signup

## 3b. Build the release bundle
```bash
cd mobile
npx cap sync android
npx cap open android   # opens Android Studio
```
In Android Studio:
1. Let Gradle finish syncing (bottom status bar)
2. Test: pick a device/emulator → Run ▶
3. Build release: Build menu → "Generate Signed Bundle / APK"
   → choose "Android App Bundle"
   → "Create new..." keystore (SAVE THIS FILE AND PASSWORD FOREVER — you need
      the same keystore for every future update)
   → finish → produces an .aab file

## 3c. Submit
- Play Console → Create app → fill listing (name, description, screenshots,
  privacy policy, content rating questionnaire)
- Production → Create release → upload the .aab → roll out

═══════════════════════════════════════════════════════════════
SUMMARY OF WHAT YOU NEED TO ACQUIRE
═══════════════════════════════════════════════════════════════
- [ ] Apple Developer account — $99/yr (covers DMG signing + iOS)
- [ ] Google Play Console — $25 once (Android)
- [ ] App-specific password + Team ID (free, from Apple account)
- [ ] GitHub token (free, for DMG auto-publish)
- [ ] Privacy policy URL (both stores require it — can be a page on runonaspen.com)
- [ ] Screenshots for both store listings
- [ ] An Android keystore file (created during first build — keep it forever)

Everything in the code is ready. These are the external accounts only you can set up.
