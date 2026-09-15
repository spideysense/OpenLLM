# Household service and document vault

Aspen now has two runtime entry points: the existing Electron desktop and a Node household service. They share the gateway, inference orchestration, permissions, model catalog, encrypted records, vault and backup format. A process lock prevents simultaneous writers to the same profile. The service serves its bundled household interface at `/household`; it does not need a graphical login.

This branch is for qualification. It is not yet a factory-qualified appliance image. No physical hardware performance, thermal, microphone, power-loss or nontechnical-family onboarding result is claimed.

## What works

- Household documents: import TXT, Markdown, CSV, JSON, PDF, DOCX, XLSX and XLS; retain original bytes; search extracted text locally; return source names, SHA-256 identifiers, import dates and character offsets. Search is lexical, not semantic/OCR. Up to 4 MB per file, 1,000 documents and 256 MB of originals. The first 100,000 extracted characters are indexed and truncation is visible. This is a bounded document collection, not a photo library or NAS.
- Privacy: document ownership is separate from household administrator status. Owners explicitly share individual documents with person IDs. A household owner does not inherit another person's vault through the API. The machine/backup administrator still controls the physical system and encryption keys.
- Retention: keep until deletion or specify expiry; original and recovery files are removed after deletion/expiry. Exported backups and downloaded copies retain their own lifecycle. This is logical deletion, not a promise of forensic erasure from an SSD or a filesystem snapshot.
- Context grants: only a document owner may grant external access to selected documents. A grant has a purpose, recipient label, expiry, request limit and excerpt character limit. Default: one hour, 20 requests, 2,000 excerpt characters per request. Maximum: one day, 100 requests, 8,000 characters. Revocation is immediate for future requests. Deleted/expired documents cannot be returned. Recipient is an audit label, not an authenticated provider identity: anyone holding the credential can use it until revoked or expired. A recipient can retain already disclosed text.
- Credentials: a context credential can use only `/v1/context`; it cannot invoke chat, models, missions, publishing, memory or vault administration. Household and context APIs require the authenticated application-encrypted transport. They do not accept plaintext bearer requests.
- Local inference: `vault_search` reads only the current person's accessible documents. After a vault read, the same inference request can use only vault search, arithmetic and date tools. The dispatch boundary blocks network, connector, shell and publishing tools, even if the model requests one. This guard does not claim to detect every private fact in arbitrary conversation history; enabled network tools and explicitly selected Cloud Boost retain their documented disclosure behavior.
- Audit: recent import, download, permission, deletion, expiry, grant, revocation and context events stay encrypted on the box. Audit records omit query text, excerpts and secrets. At most 10,000 events are retained; each person sees their own recent 200.
- Recovery: portable password-encrypted backups now include the vault's original files, extracted content and metadata. Restoring revokes context grants and rotates device pairing credentials. All vault contents are validated before the restore journal is written. The journal makes interrupted restoration repeatable.

## Build and run

Use Node 22.12 or newer. Install the reviewed source and dependencies, then build both interfaces:

```sh
npm ci
npm run build:renderer
npm run build:household
```

The service expects `ASPEN_DATA_DIR` and `ASPEN_KEY_FILE`. Its 32-byte credential must be a private regular file. It never creates a plaintext master key next to household records. Without an encryption provider it refuses to start; vault imports also fail closed on desktop systems without secure storage. Existing desktop records use the OS keychain. Move encrypted data between runtimes with the portable backup flow, not by copying OS-bound ciphertext.

`scripts/aspen-service.service` uses `/opt/aspen`, `/var/lib/aspen`, a dedicated unprivileged account, restrictive filesystem permissions and a TPM-sealed systemd credential. `scripts/install-service.sh` installs it on a prepared Linux image. The installer requires TPM support and a systemd version supporting encrypted credentials; it does not silently fall back to a disk-resident plaintext decryption key. Validate boot/recovery against the exact firmware, OS and TPM policy before shipping.

The factory image must contain the reviewed Ollama binary before household enrollment. On first service boot, Aspen picks a fitting model from the trusted catalog, downloads it if necessary, and verifies its exact tag, digest, chat and tool readiness before saving it as active. Setup progress appears in the household owner interface. Existing selected models are qualified without silently changing the selection.

The API binds to loopback. Local access works at `http://localhost:4000/household`. For remote household access, configure an authenticated HTTPS ingress to that loopback service. The application-encrypted channel protects payloads through the ingress; web-client integrity still depends on trusted HTTPS delivery. The service does not automatically create a public tunnel or expose Ollama.

For initial enrollment, display the owner credential locally using `scripts/pair-service.cjs` under the service account with the same credential mounted by systemd. For example, an appliance technician can run:

```sh
sudo systemd-run --pty --wait --collect --unit=aspen-pair \
  -p User=aspen \
  -p LoadCredentialEncrypted=aspen-key:/etc/credstore.encrypted/aspen-key \
  -p 'Environment=ASPEN_DATA_DIR=/var/lib/aspen ASPEN_KEY_FILE=%d/aspen-key' \
  /usr/bin/node /opt/aspen/scripts/pair-service.cjs
```

The helper refuses redirected output. For headless backups, stop the service and invoke scripts/backup-service.cjs export|restore /path/to/file.aspen under the same credential setup. It reads passwords without echoing them, uses the profile lock, and refuses to overwrite an existing export. Enter the credential in the household page, then invite family members there. The page holds credentials in tab memory; Lock clears them. This technician enrollment path is not a completed consumer QR/physical-button setup experience. Never clone an image after creating household credentials or TPM-sealed unit credentials.

## Frontier integration

Register the definition returned by `integrations/aspen-context.mjs` with your model SDK and execute its handler in your integration runtime:

```js
import { createContextTool } from './integrations/aspen-context.mjs';
const context = createContextTool({
  base: process.env.ASPEN_URL,
  credential: process.env.ASPEN_CONTEXT_CREDENTIAL,
});
// Register context.definition with the provider's function-calling interface.
// On a call, send only the returned authorized excerpts to the provider:
const result = await context.execute({ query: 'furnace warranty expiry' });
```

Keep the credential in the integration runtime, never in prompts or model-generated arguments. The adapter uses the encrypted transport and refuses an owner key. No provider-specific SDK or paid account is needed to use the Aspen side. A provider requiring raw OpenAPI actions needs an adapter implementing this transport; the private endpoint deliberately has no plaintext fallback.

## Hardware qualification

Close Aspen and other inference clients. Start the reviewed local engine, install the exact candidate model tags, then run:

```sh
node scripts/benchmark-models.cjs qualification.json model-a:tag model-b:tag
```

The harness uses a profile lock, checks installed tags/memory fit, unloads each candidate before its cold measurement, measures repeated warm latency and tokens/sec, grades deterministic arithmetic/structured extraction/source retrieval/instruction isolation/native tool calls, records model digests/hardware/observed free memory, checkpoints results and restores prior model residency. It leaves the default unchanged. The small task suite is not a universal intelligence score; “cold” does not mean the OS disk cache was flushed.

Device acceptance must additionally cover sustained thermal behavior, physical memory pressure, Wi-Fi loss, power loss during writes/restoration, disk full, multi-person contention, vision/audio, suspend/resume and a real family's setup session. No device was purchased or benchmarked during this change.

## Verification and remaining external gates

- Behavioral service test: `node scripts/verify-household.cjs` exercises encrypted disk records, actual HTTP, WebCrypto, isolation, sharing, grants, retention, deletion, restore, profile locking and the local-only tool boundary without downloading a model.
- Desktop and household UI tests exercise credential creation/revocation, shared-document restrictions and visible errors. The hosted browser could not connect to the local loopback service in this environment, so visual acceptance is not claimed.
- Native qualification CI compiles the complete Swift iOS app without signing, runs CryptoKit↔Node fixtures, and builds an Android debug APK. These jobs passed on the implementation commit. They do not validate real device Keychain, audio, networking or MLX performance.
- Our source review and adversarial tests are an internal security review. An independent audit of the encryption protocol, household permission model and appliance image still requires an external reviewer.
- Signed release preparation is described in `docs/release-qualification.md`. A shipping release still requires platform signing credentials and real upgrade/device acceptance. This change neither merges the PR nor publishes a release.

Final local checks: **818 tests passed, 20 pre-existing skips, 47 files**; both production web builds; all four standalone module suites; workflow YAML and shell syntax; clean root dependency installation. Root production and development dependency audits report **zero known vulnerabilities**. Older release source-pattern tests were replaced with execution-based signing/order/failure tests, so raw test counts are not a count of newly fixed defects.
