# Aspen appliance delivery

## Consumer setup

The first version uses Ethernet to the home router, with the phone on the same home Wi-Fi. No household account or public tunnel is required. Wi-Fi-only appliance provisioning is not implemented.

1. Plug in Ethernet and power.
2. In the Aspen phone app, select Connect → Scan QR code and scan the private card packaged with that unit.
3. Enter your name, save the new recovery code, and confirm setup.

Each unit has a random `aspen-<12 hexadecimal digits>.local` name. Port 4001 accepts only authenticated encrypted protocol requests. It serves no HTML, JavaScript, raw model endpoint, or public artifacts, and rejects browser Origin requests. The local browser interface remains on `http://localhost:4000/household`. A remote browser still requires a separately trusted HTTPS ingress; do not point a phone browser at an untrusted HTTP copy of the application.

Setup is two-phase. Preparing it returns a pending device credential and recovery code without activating either. Confirmation atomically replaces owner credentials and consumes the setup code. Pending setup expires after 15 minutes. Repeating preparation before expiry returns the same pending result, so a dropped response does not create competing identities. Mobile clients save the pending credential to Keychain/SecureStore before confirmation and check it after an interrupted confirmation.

Recovery codes have 256 bits of randomness and authorize only enrollment, not document or inference APIs. Restoring owner access issues new owner and recovery credentials and revokes the old ones. Family identities and documents remain. Anyone holding the current recovery code can restore owner access: keep it separately from the appliance. Portable whole-device restoration removes enrollment and recovery credentials, so old backups cannot resurrect them.

Existing households keep their identities when upgrading. The owner can establish a new recovery code from Family in the local household interface. Family invitations include QR pairing codes; the native iOS and React Native clients scan them. Pairing credentials remain revocable in Family.

## Document recovery without a terminal

The desktop and household vault include **Back up or restore my documents**. Each person can create a password-encrypted `.aspendocs` file containing only originals they own. Encryption runs on the client with AES-256-GCM and PBKDF2-SHA256 (600,000 iterations, fresh salt and nonce). Keep the backup off the appliance and the password separately.

Restore authenticates and verifies every file before uploading any originals. It skips existing owned content hashes, so an interrupted restore can continue without duplicate uploads. Restored files get fresh private records; old sharing and external grants are not revived. These document backups exclude conversations and configuration. Full appliance backups remain available through the administrator CLI with exclusive profile locking.

## Factory package

`node scripts/build-appliance.cjs OUTPUT_DIRECTORY` creates an architecture-specific service archive with a Node runtime, production dependencies, the household UI, registry, runtime skills, and operating tools. The builder runs enrollment/recovery integration tests from the staged package using its bundled runtime before emitting the archive. Its manifest records the source commit and whether the source tree was dirty. Development bundles are not authenticated production releases.

Factory preparation on Ubuntu 24.04 or another explicitly qualified systemd Linux image:

```sh
# Run as the factory administrator, before enrolling this physical unit.
sudo apt-get install avahi-daemon zstd
sudo tar -xzf Aspen-appliance-linux-x64.tar.gz -C /opt
sudo bash /opt/aspen/scripts/install-service.sh
```

The installer expects systemd-creds with a working TPM2 and privileges to configure the unit. It stages a pinned Ollama release from `registry/appliance-engine.json`, verifies the entire archive's SHA-256 before extraction, creates a dedicated service identity and per-unit hostname, seals a fresh storage key to that unit's TPM, enables the service and mDNS, and saves a private printable setup card at `/var/lib/aspen/setup-card.html`. Print it locally, include it with that unit, and protect/remove the factory copy according to the assembly process. The setup secret is never printed into service logs.

Create any reusable OS image **before** running the per-unit installer. Do not clone `/etc/aspen`, `/etc/credstore.encrypted`, `/var/lib/aspen`, machine identity, SSH host keys, or an already enrolled disk. The install script refuses an existing profile without its unit identity.

For packaged administrator tools, use `/opt/aspen/runtime/node` with the same encrypted systemd credential as the service. Full backup/restore still requires stopping the service first. Installing a package on a real TPM device, firmware updates, boot-key recovery, Secure Boot, power loss and rollback require the chosen physical SKU; the local package test is not evidence for those behaviors.

## Model selection and privacy

On first appliance startup, Aspen qualifies at most two fitting, tool-capable catalog models. CPU-only candidates are additionally bounded to 5.5 GB of weights. It checks exact installed tags/digests and native tool readiness, then measures deterministic tasks and warm throughput. Candidates must pass at least four of five tasks including the native tool call. Among candidates reaching eight tokens/second, it ranks quality first and throughput second; if none reaches that responsiveness target, it chooses the best otherwise-qualified candidate. The small task suite does not establish universal model superiority.

The selected model and comparisons stay local. Later boots preserve the selected model and recheck readiness. Failed initial setup is retryable from the household interface. Engine cloud functionality is disabled in Aspen-managed Ollama processes; explicitly enabled Aspen cloud integrations are separate. Native iOS speech now uses installed system voices exclusively and no longer posts reply text to hosted TTS.

## CI and release access

`appliance-qualification.yml` builds and tests x64 and arm64 service distributions. It also reports only the presence/absence of named release credentials, never their contents. `release.yml` includes appliance archives in its authenticated provenance workflow. PR build artifacts are qualification artifacts; platform installers still require signing credentials and physical acceptance before shipping.
