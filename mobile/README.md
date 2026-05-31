# Aspen Mobile (iOS + Android)

Native wrapper for the Aspen web app, built with Capacitor 6. The web UI is
bundled locally (`www/`) and talks to `https://runonaspen.com` over the network.
Voice uses native iOS/Android speech plugins — far better than browser speech.

## What's native
- **STT**: `@capacitor-community/speech-recognition` (iOS Speech + Android SpeechRecognizer)
- **TTS**: `@capacitor-community/text-to-speech` (native device voices)
- Mic + speech permissions configured (Info.plist / AndroidManifest)
- Background audio mode enabled (iOS)
- App icons + splash generated from `assets/icon.png`

## App identity
- App ID: `com.runonaspen.app`
- App name: Aspen
- Version: 0.3.3

## Prerequisites
- **iOS**: macOS + Xcode 15+, Apple Developer account ($99/yr)
- **Android**: Android Studio, Google Play Console account ($25 one-time)

## Update the bundled web app
When `site/app/index.html` changes in the main repo, re-bundle:
```bash
cp ../site/app/index.html www/index.html
# re-apply the API_BASE + native-bridge edits if regenerating from scratch
npx cap sync
```
Note: chat/search/models all load over the network, so most updates flow live
without rebuilding. Only the UI shell is bundled.

## Build & run iOS
```bash
npm install
npx cap sync ios
npx cap open ios        # opens Xcode
```
In Xcode:
1. Select the **App** target → Signing & Capabilities → select your Team
2. Set a unique Bundle Identifier if `com.runonaspen.app` is taken
3. Connect an iPhone or pick a simulator → press Run
4. To submit: Product → Archive → Distribute App → App Store Connect

## Build & run Android
```bash
npm install
npx cap sync android
npx cap open android    # opens Android Studio
```
In Android Studio:
1. Let Gradle sync
2. Run on a device/emulator (Run ▶)
3. To submit: Build → Generate Signed Bundle/APK → Android App Bundle (.aab)
4. Upload the .aab to Google Play Console

## App Store review notes
- The app has genuine native functionality (speech recognition, TTS, haptics,
  native permissions) — not just a webview wrapper. This satisfies Apple 4.2.
- Provide a demo tunnel URL + API key to reviewers, or a short video showing
  pairing, since the app needs a running Aspen desktop instance to be useful.
- Privacy: all AI runs on the user's own machine; the app stores nothing.

## Project structure
```
mobile/
  www/                  bundled web app + native-bridge.js
  ios/                  Xcode project
  android/              Android Studio project
  assets/               icon.png + splash.png (source)
  capacitor.config.json
```
