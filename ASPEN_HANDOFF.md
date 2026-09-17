# Aspen household rewrite — September 17, 2026

User direction: Aspen is the private operating system for the home. Butler, Secure and Energy are apps. Phones, future room listening pods, screens and robots call the same household intelligence with scoped access. The target is an effortless consumer appliance and a software option on supported hardware.

## Current implementation

- `src/home/server.js`: independent HTTP/HTTPS household service, authentication, family roles, private/shared memory, local task/reminder storage, app activation, device pairing and authorization.
- `src/home/store.js`: encrypted local vault; optional desktop OS-protected key.
- `src/home/intelligence.js`: local Ollama only; conservative installed-model selection, curated download preparation and bounded context. No new fine-tuning or cloud fallback.
- `src/home/integrations.js`: local Home Assistant read/control adapter. Allowlisted lights and sensor/climate discovery; device approval and readback of light state.
- `site/home/`: same responsive UI for the local server and static sample (`?demo=1`). Hosted static mode is a sample/connect introduction; it does not silently use a cloud model or pretend to discover devices.
- `src/main/index.js`: desktop starts the isolated household server/window by default. It does not expose the broad legacy Electron preload to this window. `ASPEN_WORKSPACE=1` preserves the old AI workspace.
- `site/index.html`, `site/aspen-home.css`: new public brand and product story. Current downloads are explicitly labeled as the prior AI workspace until new installers ship.
- `site/content/knowledge.mjs`: authoritative product status and FAQs. `site/build.mjs` generates docs and machine-readable content. SEO build is now idempotent.

The full online Butler implementation supplied by the user has been inspected. The new local Butler module currently handles tasks/reminders. The online v2 execution engine, external email/phone/browser tools, billing and cloud auth have not been transplanted; no claim of full parity is made.

## Run and verify

- `npm run home` — local household service; no npm packages needed for this code path.
- `npm run test:home` — Node-based API/privacy/persistence tests.
- `npm run build:home-assets` — rebuild QR bundle from existing qrcode.react + React dependencies.
- `npm run build:renderer` — existing AI-workspace renderer remains buildable.
- `npx vitest run tests/critical/ tests/landing/seo-build.test.js` — existing critical guards and new SEO behavior.
- `node site/build.mjs && node scripts/seo-build.mjs && node scripts/seo-intent-build.mjs` — existing Vercel website build.

The original checkout had a stale lockfile (missing qrcode.react). npm install synchronized it without changing declared dependencies. The old critical assertion requiring a community-savings widget on the marketing homepage was removed because the user explicitly replaced that product story. The endpoint and existing workspace caller retain their tests. Existing first-party website visit analytics are preserved; the household application has none.

See `docs/HOME_API.md` for the device contract, access rules, deployment configuration and remaining release gates. Do not describe this as finished plug-and-play hardware or a fine-tuned model. Do not route household memory through the legacy general-purpose cloud or shell-enabled agent path.

Production publication: the full Vitest suite passes (752 assertions, four pre-existing skips), plus all ten household API/privacy tests. Landing-page checks now validate the household product, truthful release status, visible/structured FAQ agreement, accessible landmarks, local assets and working download routes. CI also runs the household suite. The user authorized publishing tested increments directly to production. Main-branch publication does not create signed desktop release installers.
