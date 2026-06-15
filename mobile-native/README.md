# Aspen — native iOS app (Expo / React Native)

A genuinely native Aspen client — real native UI components, not a webview. It
talks to the Aspen running on your machine using the same backend contract as the
web client (no server changes needed).

## What it does
- **Connect**: paste your Aspen address (`https://xxxxxxxx.runonaspen.com`) and an
  optional API key. Validated against `{address}/v1/models`.
- **Chat**: streams responses from `https://www.runonaspen.com/api/agent`, renders
  the live activity trail ("Searching the web…", "Loading model into memory…"),
  markdown answers, stop/regenerate, new chat.
- Connection is remembered between launches.

## Run it (on your Mac)

```bash
cd mobile-native
npm install
npx expo start
```

Then:
- Press **i** to open the iOS Simulator, or
- Scan the QR with **Expo Go** on your iPhone (same Wi-Fi).

Connect with your box's URL (e.g. `https://ru184h6u.runonaspen.com`).

## Build a real installable app (TestFlight / App Store)

```bash
npm install -g eas-cli
eas login
eas build --platform ios --profile preview   # or --profile production
```

EAS builds in the cloud and returns an installable build (no local Xcode needed,
though you can also run `npx expo run:ios` with Xcode installed).

## Requirements / notes
- **Expo SDK 52+** — streaming uses `expo/fetch` (WHATWG ReadableStream body).
- Native apps aren't subject to browser CORS, so the connect call hits your box
  directly; chat goes through the `/api/agent` proxy exactly like the web client.
- Icons/splash are copied from the existing `mobile/assets`. Swap in final art any
  time under `mobile-native/assets`.
- This is separate from the Capacitor app in `mobile/` (that one is a webview
  wrapper) — this is the native rewrite.
