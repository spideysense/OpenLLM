# Aspen household API — developer preview

One home brain; many explicitly authorized clients. This API runs in the household process, independently of the existing general-purpose AI workspace gateway.

## Start

Requires Node.js 20+. From the preview source: `npm run home`.

The default address is `http://127.0.0.1:4141`. On first launch, open the private setup link printed by the process. The fragment contains a random bootstrap secret required to claim the home. It is removed from browser history by the UI. Set a name and a password of at least 12 characters. This preview has no password recovery: retain the password.

Configuration:

| Variable | Purpose |
| --- | --- |
| `ASPEN_HOME_DATA` | Household vault directory; defaults to `~/.aspen/home` in headless mode. |
| `ASPEN_HOME_PORT` | Listening port, default 4141. |
| `ASPEN_HOME_HOST` | Listening interface, default 127.0.0.1. Non-loopback interfaces require TLS. |
| `ASPEN_HOME_ORIGIN` | Exact HTTPS origin when serving under a hostname; must match the TLS listener. |
| `ASPEN_TLS_CERT`, `ASPEN_TLS_KEY` | Paths to a valid HTTPS certificate and key for access from other devices. |
| `ASPEN_VAULT_KEY` | Optional 32-byte hex vault key supplied by an external secret manager. |
| `ASPEN_WORKSPACE=1` | Desktop only: open the existing AI workspace instead of the household UI. |

The default loopback setup cannot be reached from a phone. To test multiple physical devices, configure a valid TLS certificate, reachable origin and LAN listener. A public cloud instance can host accounts and tasks but cannot discover or operate home-network devices without a home connector. Do not expose this preview directly to the public internet.

## Identity

Browser sessions use an HttpOnly, SameSite=Strict cookie, Secure under HTTPS. Sessions expire after 12 hours and are revoked at sign-out. Passwords are salted and hashed with scrypt. Each person joins through a one-time invitation (15-minute expiry). There is one owner; adult, child and guest roles have progressively limited access.

Private memory is always filtered by the authenticated account. Owner status does not grant access to another member's private notes. Owner audit events contain action names and opaque IDs, not private note content.

## Device pairing

1. As the owner, open Settings → Pair a device.
2. Choose the device type, room and scopes.
3. Scan the QR or copy its payload. It contains `{version:1, endpoint, code}`.
4. POST the code to the endpoint, setting `Content-Type: application/json` and `Origin` to the configured Aspen origin:

```json
{"code":"ONE_TIME_PAIRING_CODE"}
```

The response contains a token once:

```json
{"token":"STORE_SECURELY_ON_CLIENT","client":{"id":"UUID","scopes":["home:read","chat:ask"],"roomId":"UUID"}}
```

Subsequent requests use `Authorization: Bearer <token>`. The home stores only its hash. Codes expire in five minutes and can be redeemed once. Revoking a client disables the token immediately. Browser Origin and Host checks still apply. A caller cannot impersonate another member by including a user ID in the request.

Pod and robot clients require a room. All API device clients, including phone clients, receive only household-shared memory and tasks. A phone user who needs personal memory should use their individual browser session. Speaker recognition is not an identity mechanism.

## Scopes

| Scope | Allowed |
| --- | --- |
| `home:read` | Shared household state, members' display names/roles, scoped rooms and approved devices. |
| `chat:ask` | Local model answers using authorized shared memory and tasks; room context is assigned by the server. |
| `tasks:write` | Create and complete shared tasks while Butler is installed. |
| `devices:control` | Turn approved lights on/off within the assigned room. |

No arbitrary shell access, executable plugins, payments, alarms, locks or robot movement. The model has no action tools in the household chat: mutations use explicit API controls with independent authorization.

## Routes

All paths below are relative to `/v1/home`.

| Method and path | Input / behavior |
| --- | --- |
| GET `/status` | Product version and whether the home is claimed. No personal data. |
| POST `/setup` | `{bootstrap, name, homeName, password}`; initial owner claim. |
| POST `/login` | `{name, password}`; sets a browser session cookie. |
| POST `/logout` | `{}`; revokes the browser session. |
| GET `/state` | Authorized household state; credentials and token hashes excluded. |
| POST `/invites` | Owner only, `{role: "adult" | "child" | "guest"}`. Returns one-use link. |
| POST `/join` | `{invite, name, password}`. |
| DELETE `/members` | Owner only, `{id}`. Disables member and associated clients. |
| POST `/rooms` | Owner only, `{name}`. |
| POST `/memories` | Human member except guest, `{text, visibility:"private" | "household"}`. Default private. |
| DELETE `/memories` | `{id}`; only the author can delete. |
| POST `/tasks` | `{title, dueAt?:ISO8601, visibility?}`. Device-created tasks are always shared. |
| PATCH `/tasks` | `{id, done:boolean}`; must be visible to the caller. |
| POST `/apps` | Owner only, `{id:"butler"|"secure"|"energy", install:boolean}`. |
| POST `/clients` | Owner only, `{name, type:"phone"|"screen"|"pod"|"robot", roomId?, scopes:[]}`. Returns one-use code. |
| POST `/pair` | `{code}`; returns the new device token. |
| DELETE `/clients` | Owner only, `{id}`; immediate revocation. |
| GET `/models` | Owner only, local runtime, hardware, conservative model selection and download status. |
| POST `/models/prepare` | Owner only, `{}`; downloads a curated model through the local runtime. No household data is sent. |
| POST `/chat` | `{message}`; answers through loopback Ollama only. No cloud fallback. |
| POST `/connections/ha` | Owner only, `{url, token}` for local Home Assistant. Discovered devices initially disabled. |
| DELETE `/connections/ha` | Owner only, `{}`; deletes connector credentials and device records. |
| POST `/devices/discover` | Owner only, `{}`; refreshes supported devices/readings from connected Home Assistant. |
| PATCH `/devices` | Owner only, `{id, enabled:boolean, roomId?}`; explicitly grants device access. |
| POST `/devices/action` | `{id, action:"turn_on"|"turn_off"}` for permitted lights. Returns observed state and `confirmed`. |

Mutations require JSON. Cookie-authenticated browser mutations require an exact Origin match. Network reads are bounded and use timeouts. Home Assistant uses private IPv4 destinations, pins resolved IPs per request, validates TLS when used and refuses redirects, preventing credential leakage via redirects or DNS rebinding.

## Local operation

The encrypted household vault uses AES-256-GCM and atomic replacement. The desktop wraps its key with the OS key store when available. Headless mode uses an external key or a restricted key file. File encryption does not protect against a compromised OS or an attacker holding both a headless key file and the vault. Use full-disk encryption.

Tasks persist across restarts. A local 15-second scheduler marks due reminders and desktop notification support displays them; missed reminders are processed when Aspen next runs. The computer must remain powered on to deliver on time. Removing Butler pauses reminders but preserves tasks. This is not medical, safety or emergency monitoring.

## Release boundaries

Implemented and tested: local household state and authentication; memory visibility; task persistence; role/scoped API authorization; one-use pairing; Home Assistant adapter; responsive UI; static sample home; website positioning.

Not yet delivered: native signed household release installers; direct Matter commissioning; Wi-Fi/Bluetooth provisioning; full offline mobile packaging; household-specialized fine-tuning; measured latency/accuracy-based model selection; local wake-word/STT/TTS pods; robot adapters; cloud synchronization; password recovery; backup/restore UI; independent security review; executable third-party app sandboxing; migration of the full online Butler engine.

The model choice is a conservative installed-model memory fit, not a claim of the best model on each device. Real hardware, real Ollama models and Home Assistant devices require integration validation outside the test fixtures before consumer release.

### Reviewable message plans (source build after 0.9.0)

- `POST /v1/home/plans/draft` with `{source}` drafts up to five task titles using the running local model. Requires a signed-in non-guest human and installed Butler. Returns `{id, tasks, expires}`; saves nothing. One pending draft per member, valid for ten minutes. Source text is not persisted.
- `POST /v1/home/plans/approve` with `{id, tasks: [{title, dueAt}], visibility}` saves the reviewed tasks together. `visibility` defaults to private; date/time entry is explicit. Draft IDs are member-bound and consumed once. A second approval returns 409. Room clients cannot use either route.
- The workflow performs no email, calendar, booking, purchase or device actions. The public website scenarios are fictional interactive concepts, separate from this working local task flow.
