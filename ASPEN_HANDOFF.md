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

The signing-Mac release command for the first household preview is `npm run release:mac -- 0.9.0` after pulling main and `npm ci`. `scripts/smoke-home.js` now checks the real household setup and task flow in an isolated Electron window before packaging; the legacy workspace smoke remains. The browser harness uses a temporary vault, ephemeral port and no saved credentials or connected devices. Native execution still needs the signing machine.

## Consumer website and waitlist

The homepage leads with the family use case and a single launch/early-access waitlist form. The sample home is secondary; source setup/current legacy downloads are in an expandable developer section. `site/waitlist.js` only confirms a signup after a durable server acknowledgment and supports undo with the receipt returned to that browser. No confirmation or promotional email is sent by this flow.

`api/waitlist.js` uses the existing KV_REST_API_URL/TOKEN or UPSTASH_REDIS_REST_URL/TOKEN. `src/cloud/waitlist.cjs` implements atomic deduplication, consent records, one-hour hashed-IP rate limits and receipt-authorized deletion. Redis keys share `{aspen:waitlist:v1}`. Missing storage or provider failures return 503; there is no in-memory success fallback. Waitlist records are website contact data, separate from the local household vault.

`/admin` uses its existing server-side ADMIN_PASSWORD gate to view/export signups; `api/admin-stats` action `waitlist` paginates 200 records at a time and strips deletion receipts. Contact addresses are marked unverified. CSV exports neutralize spreadsheet formulas. Verify mailbox ownership and provide unsubscribe handling before using this list for launch campaigns. The public form gives explicit launch/early-access consent, and privacy information describes hosted storage and removal.

The household UI now has direct Tasks and Notes navigation, plain screen/action labels, first-task guidance, and developer device pairing under an expandable Advanced section. The underlying privacy and device permissions are unchanged.

Production packaging: keep the shared waitlist module explicitly CommonJS (`.cjs`). The Vercel API build compiles these JavaScript handlers to CommonJS; importing an ESM-only helper caused invocation failures on deployment. Verify the packaged function as well as Vitest when changing this boundary.

## Family moments and local plan drafting

Homepage `#moments` now offers three interactive, fictional scenarios: school pickup changes, leaving home, and family dinner. Sources can be inspected, sample approval changes the illustrated plan, and follow-ups clarify uncertainty. This is explicitly a concept; no accounts, emails, calendars or devices are accessed. `site/moments.js` is self-contained with no external dependencies or requests.

The source-build app adds Make a plan: paste up to 4,000 characters, draft up to five tasks through local Ollama, then review/edit/select and explicitly save. `POST plans/draft` is human-member-only, bounded, expires after ten minutes and does not persist source text. `POST plans/approve` authenticates ownership, validates the whole batch before mutation, consumes the draft once and saves to the encrypted vault with private visibility by default. Dates are manually confirmed; models cannot send emails, write calendars, order goods or control devices through this flow. No cloud inference fallback. Native 0.9.0 installers do not contain this later source change.

Chat/UI state is now cleared on sign-out, authentication screens and member changes. Epoch guards reject pending replies from previous personal sessions. The same household web UI is used by the new desktop surface and responsive browser; legacy workspace clients are separate.

Release status: Mac and Windows 0.9.0 household installers published successfully at commit c9e0f207b1cf6d8d936c01eab3017319c548686f. Linux dispatch was requested from the signing machine but has not been verified here.

## September 19 waitlist launch design

The public homepage now sells the forthcoming full Aspen experience, with a primary waitlist CTA, two photorealistic flat-disc pod/hub concept renderings, and licensed real family photography. `site/aspen-waitlist.css` extends existing shared marketing styles; sample moments and the durable waitlist API remain unchanged. Hardware visuals are concepts, not shipping products. Everyday use cases cover last-seen objects, identity-confirmed family handoffs, daily briefings, Butler tasks, Secure and Energy. The page explicitly distinguishes planned experiences from the 0.9.0 developer software; pricing and launch dates are not invented. Asset provenance and generation prompts are in `site/images/ASSETS.md`.

## Waitlist referrals

New signups get a public 96-bit referral code and a separate private 256-bit receipt capability. PATCH /api/waitlist uses only the private receipt for position/referral count; no public code or email lookup exposes contact information. The browser saves only the receipt, and offers a private fragment-based status link plus a distinct public invite link. Existing pre-referral records remain in the queue; their original undo receipts still work, but users without a saved receipt need support to recover access. No emails are sent.

Atomic Redis Lua signup creates code/receipt indexes, deduplicates signup email and common plus/Gmail aliases for credit, credits one existing inviter, and shifts their ORDER score earlier by seven days. Signup time minus seven days per active credited referral determines actual queue position. Deletes revoke indexes and reverse the inviter boost atomically. Admin lists/CSV use priority order and include position and referral count. Addresses remain unverified: these controls reduce simple abuse but do not prove unique humans; verify recipients before granting scarce early access.
