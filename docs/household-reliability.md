# Household reliability and privacy repair

The subsequent household implementation is documented in [household-service.md](household-service.md), with delivery gates in [release-qualification.md](release-qualification.md). Those documents supersede the earlier implementation limits below.

This change repairs the existing Aspen application across desktop, gateway, browser, React Native, and native iOS. It is a foundation for a household product, not a claim that a shipping appliance or the best model on every device has been qualified.

## Behavior and review map

| Area | Implemented behavior | Evidence |
| --- | --- | --- |
| Household permissions | Unknown gateway routes are denied. Missions and publishing require ownership. Guest keys cannot inherit owner connector or computer permissions. Generic renderer store reads cannot retrieve internal credentials. | Real IPC, gateway, and dispatch regression tests |
| Tool choices | Dispatch checks identity, the exact offered tools, and current settings. Computer control requires explicit opt-in. The separate desktop refusal-to-shell path is removed. | Fabricated tool call and live-policy tests |
| Remote privacy | Paired clients use an authenticated encrypted channel directly to their box. The old hosted plaintext relay returns an update-required error. | Browser WebCrypto ↔ Node integration, tamper/replay/revocation/disconnect tests; mobile bundle exports |
| Chat lifetime | One long-lived job per desktop conversation; token events, request IDs and sequence numbers; partial/completed replies persist independently of the window; reconnect snapshots deduplicate replies. | Concurrent stop, recovery, disk-failure and actual React remount tests |
| Settings and invitations | Settings are allowlisted and validated, rejected writes surface, family invitations preserve memory opt-in, key rotation preserves the memory identity. | Actual IPC tests |
| Memory | Extraction can reuse the sole resident chat model. Background extraction uses admission control and yields to foreground work. Deletion leaves a revision marker, preventing stale extraction from restoring deleted facts. Fact storage no longer silently trims history; prompt context remains bounded. | Existing per-person memory tests and admission tests |
| Model downloads | Shared buffered NDJSON parsing, split UTF-8 support, explicit final success, exact installed-tag verification, cancellation and surfaced failures. | Split-error, premature EOF and exact-tag tests |
| Model promotion | Recommendations respect device memory. Research can rank trusted catalog entries; it cannot certify its own invented metadata. Exact tag/digest, chat and native tool-call readiness are checked before automatic promotion. The previous model is retained. | Promotion failure and exact-tag regressions; readiness implementation requires device runs |
| Cleanup | Deletion requires explicit policy, a matching qualification, managed ownership, and exclusion of pinned/previous models. User-installed models are not automatically deleted. | Model-manager suite; guard inspection |
| Storage and recovery | Atomic file replacement, restrictive permissions, valid previous-copy recovery, immutable in-memory store reads, OS-keystore encryption when available, password-encrypted portable backups with restartable restore. | Corruption, encrypted records, failed writes, retention and interrupted-restore tests |
| Resource use | Hardware-based admission and engine limits replace unconditional four-slot serving. Foreground requests preempt background inference. Shell work and gateway computer operations are asynchronous and cancellable. | Admission/cancellation tests and source verification |
| Vision and voice | The shared native model adapter handles images; desktop uses reported capabilities. Desktop/iOS speech requests require local recognition rather than silently using remote transcription. | Existing capability tests; physical vision/audio checks remain required |
| Delivery | Lockfiles are consistent, runtime skills are included, the supported GitHub connector is bundled, Linux provisioning shares application configuration/model policy, and React Native dependencies match Expo 56. | Clean install, renderer build, connector discovery, iOS/Android JS exports |
| Updates | Privileged renderer-only updates are retired. macOS uses full application updates. Unsigned Windows/Linux release pipelines use manual installation until artifact authentication is established. Installing on quit is disabled. | Update guards; signing remains a release gate |

## Encrypted device protocol, version 1

A pairing secret is generated from 24 random bytes and transferred through the existing pairing flow. Clients never transmit that secret as a bearer credential on the encrypted transport.

Keys are SHA-256 of distinct domain labels plus the secret: `aspen-id-v1:`, `aspen-request-v1:`, and `aspen-response-v1:`. The ID is a lookup value. Request and response keys are separate AES-256-GCM keys. Requests use a fresh 96-bit nonce and the authenticated data `aspen-request-v1`. The encrypted payload contains method, approved path, body, and a timestamp. The box accepts a two-minute clock skew and persists accepted nonces for four minutes, rejecting replay. This requires reasonably synchronized device clocks.

Responses are NDJSON envelopes containing authenticated status, byte, and terminal frames. Each frame has its own random nonce; authenticated data binds it to the request nonce. Monotonic encrypted sequence numbers reject reordered frames. Missing terminal frames produce an interruption error. Cancellation closes the server-side stream and propagates into the running job. Key validity is checked as agent work advances.

This protects content from a passive tunnel/relay intermediary. It does not hide endpoint, timing or message sizes. It does not protect a compromised endpoint, maliciously replaced web-client JavaScript, leaked pairing secrets, or already authorized disclosures to tools/cloud providers. Raw bearer-authenticated compatibility APIs still exist for explicitly configured integrations; their HTTPS intermediary is outside this application-encryption guarantee. Independent cryptographic/security review is required before making a production end-to-end-encryption claim.

Update the box and clients together. Older clients receive an update error; the new clients do not fall back to plaintext. Native iOS no longer automatically retries an interrupted agent request, because an action might have completed before the connection failed.

## Data migration and recovery

Existing configuration, conversations and named secrets remain at `~/.aspen`. Startup migrates plaintext records when an OS encryption provider is available. A locked/unavailable keychain cannot silently replace encrypted data with empty records. Startup failures show a recovery error. Only one desktop instance may own the profile.

Linux `basic_text` storage is treated as unencrypted. Settings reports when OS-keystore encryption is unavailable; in that state records rely on file permissions and separately configured full-disk protection. Atomic JSON records are recoverable, but are not a scalable document database or a complete household NAS.

Portable backups contain configuration, memory, missions, conversation history, and managed vault documents. They use scrypt plus authenticated AES-GCM and require a password of at least 12 characters. Model weights, published artifacts, external files, and the separate named git/deployment secret store are not included. Connector tokens are deliberately dropped on import because their blobs belong to the old OS keystore; reconnect those accounts. Pairing secrets rotate while person IDs remain stable. Missions are stopped and Cloud Boost is disabled on restore. This avoids restarting historical actions or resurrecting revoked device credentials. Re-pair devices after restoration.

The JSON restore journal makes configuration/conversation/vault replacement restartable. Configuration and vault authorization records now fail closed on corruption instead of automatically falling back to revoked credentials in a previous copy; explicit portable backup restoration rotates those credentials. It is removed only after both have been written. Back up before trying this prerelease branch; do not downgrade an encrypted profile to an older Aspen version that cannot read its record format.

## Qualification still required before shipping

- Native Swift compilation and Android debug APK builds now pass in CI. Sign and run them on physical devices. JavaScript exports do not validate Keychain/SecureStore, microphone privacy, mobile background suspension, or platform networking at runtime.
- Validate chat/tool/vision quality, warm/cold latency, memory pressure, thermals, power failure, disk full, and multi-person use on the actual proposed hardware. The current readiness probe measures basic operation, not comparative intelligence or universal optimality.
- Qualify a factory-reset appliance image and a nontechnical family onboarding session. The original desktop provisioning script requires graphical login; the new scripts/install-service.sh and Node entry point remove that dependency for a prepared Linux image. Never clone an image after household enrollment.
- Establish signed Windows/Linux delivery and test upgrades/rollback on every supported platform. The deprecated GitHub server has been replaced by GitHub’s maintained hosted MCP service. Existing users must explicitly reconnect to approve the endpoint change.
- The household vault, scoped context grants, standalone service and benchmark harness are now implemented. See household-service.md for their tested behavior, concrete limits and physical-device qualification gates.

## Verification commands

```sh
npm ci --ignore-scripts
npm run build:renderer
npm test
node --test src/main/*.test.js
bash -n scripts/provision-appliance.sh
cd mobile-native
npm ci --ignore-scripts
npx expo export --platform ios --platform android --output-dir /tmp/aspen-mobile-export
```

The reliability tests are in `tests/reliability`: actual IPC and gateway contracts, tool dispatch, storage/backup behavior, concurrency, encrypted transport, and React stream recovery. Existing source guards that enforced the retired architecture have been updated; behavior tests carry the core correctness assertions.

Verified in this workspace: both clean dependency installs; renderer production build; **816 passing tests, 20 existing skips across 41 files**; all four standalone module suites; iOS and Android Hermes JavaScript exports; bundled GitHub MCP discovery of 26 tools without a system Node/npx dependency; provisioning shell syntax and `git diff --check`. Native Swift compilation/signing and physical-device inference/voice/appliance tests were not available here.


Subsequent qualification also removed remote executable speech code, updated the build/test tools and vulnerable parser dependencies, and added isolated Office/PDF extraction with archive expansion limits. Native iOS and Android build jobs passed at e70e6edae4d489673968af5693cb8f431b940982. Updated automated evidence is recorded in household-service.md and the PR.
