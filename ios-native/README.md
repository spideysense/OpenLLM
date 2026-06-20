# Aspen — native iOS (Swift + MLX)

A fully native SwiftUI app with on-device inference via Apple MLX (Metal) — the
same framework Locally AI is built on. Native streaming, native animations, no
React Native. Two tiers: on-iPhone model (instant, offline) and connect-to-box
(the big models).

**Built but not compiled here** — there's no Xcode/macOS in the sandbox. The MLX
API is verified against Apple's WWDC25 session and ml-explore/mlx-swift-examples,
not guessed. Expect to build on your Mac and iterate once on a device.

## Files
```
Aspen/Engine/LocalEngine.swift    on-device MLX inference (load-once, streaming)
Aspen/Network/BoxClient.swift     box SSE client (matches the gateway contract)
Aspen/Models/ChatViewModel.swift  unifies local + box, drives streaming + status
Aspen/Views/ChatView.swift        chat UI: streaming bubbles, animated thinking
Aspen/Views/AppEntry.swift        onboarding, tier sheet, @main app
Package.swift                     verified MLX deps
```

## Setup (Mac, Xcode 16+)
1. **New Xcode project** → iOS App → SwiftUI → name it Aspen, bundle id
   `com.runonaspen.app` (same as the RN app, so it's an update to the listing).
2. Drag the `Aspen/` folder's `.swift` files into the project (delete the default
   ContentView; `AppEntry.swift` provides `@main`).
3. **Add packages** (File > Add Package Dependencies):
   - `https://github.com/ml-explore/mlx-swift` → add **MLX**, **MLXNN**
   - `https://github.com/ml-explore/mlx-swift-examples` → add **MLXLLM**, **MLXLMCommon**
4. **Signing**: your team; **Deployment target iOS 17**.
5. Build to a **real device** (MLX needs Metal; the simulator won't run it).

## ⚠️ Verify before shipping
- **Model id** in `LocalEngine.defaultModelId` (`mlx-community/Llama-3.2-3B-Instruct-4bit`)
  must resolve on Hugging Face. MLX-community model names occasionally change; open
  the HF page and confirm. To use a smaller/faster model, swap to a 1B 4-bit id.
- **MLX-swift versions** are pinned to a known-good pair; if you bump one, bump both.
- First launch downloads ~2 GB. The onboarding screen handles the progress; test on
  Wi-Fi.

## What's wired
- **On-device streaming** — `generate` token stream → bubble updates live. This is
  the thing the RN app couldn't do well.
- **Box mode** — same `/api/agent` SSE contract as the web app, including the
  `aspen_model` event (footer shows the real routed model) and `aspen_status`
  (the "thinking / searching the web" narration).
- **Native feel** — spring insert animations on bubbles, `symbolEffect` animated
  thinking indicator, `sensoryFeedback` haptics, `.presentationDetents` tier sheet.

## Not yet built (fast follows)
- Connect-to-box screen (paste tunnel URL + key → `BoxClient.fetchModels` → set
  `vm.boxConfig`). The client is ready; it needs a small form view.
- Memory modal (GET `{tunnelUrl}/v1/world-model`).
- Conversation persistence (currently in-memory per session).
- Markdown rendering in bubbles (plain text now; add swift-markdown or
  AttributedString).

## Ship
Archive → TestFlight → App Store. Bundle id matches the existing app, so it
replaces the RN build. Bump the version above whatever's currently live.
