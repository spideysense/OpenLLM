# Cloud Boost (optional)

Opt-in cloud assist that keeps Aspen's privacy promise. **Off by default.** Local
is always the default path; cloud only fires when the user explicitly boosts a
request (or turns on auto-fallback). Every cloud answer is marked as having left
the machine, and every message is run through the privacy minimizer first.

## Modes (`CLOUD_MODE`, also user-settable)
- `off` — never use cloud.
- `boost` — cloud only on an explicit per-request boost. **Default.**
- `auto` — boost, plus auto-escalate when the local model fails/declines.

## Privacy
`context-minimizer.js` is the chokepoint for every boosted request: it redacts
emails, secrets/keys, IPs, home paths, phone numbers, and any supplied
identifiers (name/company), and trims to the last few turns with a sanitized
system prompt. Personal data and full local context stay on the box; only the
minimal text needed to answer goes out.

## Providers — free-first, rotate, BYO for the top models
Set any keys you have. Free tiers are rotated round-robin (no card needed); BYO
paid keys are used only if no free provider is available.

Free tiers: `GEMINI_API_KEY` (Gemini Flash), `GROQ_API_KEY`, `OPENROUTER_API_KEY`,
`CEREBRAS_API_KEY`, `MISTRAL_API_KEY`, `ZHIPU_API_KEY` (GLM).
BYO paid: `ANTHROPIC_API_KEY` (Claude), `OPENAI_API_KEY`, `GEMINI_API_KEY` (Gemini Pro).

Model IDs are env-overridable (`GROQ_MODEL`, `ANTHROPIC_MODEL`, …) — verify current
IDs for each provider. NB: there is **no** free official API tier for Claude/GPT
flagship models; "free" = the rotated free tiers above. No burner-account rotation
or unofficial endpoints — those get keys banned and break.

## Wiring it into the live chat path (one spot)
`cloud.js` is the only entry. In `gateway.js`, where `/v1/chat/completions` is
proxied to Ollama (~line 433), before proxying:

```js
const cloud = require('./cloud');
// explicit boost: a {boost:true} body field or an `x-aspen-boost: 1` header
if (cloud.enabled() && (parsed.boost || req.headers['x-aspen-boost'])) {
  const out = await cloud.boost(parsed.messages, { identifiers: USER_IDS });
  if (out) return respondOpenAIStyle(res, out.text + out.marker); // skip Ollama
}
// …otherwise proxy to Ollama as today. For mode 'auto', call
// cloud.autoFallback(parsed.messages, { localFailed:true }) in the Ollama error path.
```

This is the live streaming path for every client, so wire + test on the box
(restart picks up server changes; no rebuild). Until wired, the module is inert —
same staged approach as `backend.js`.
