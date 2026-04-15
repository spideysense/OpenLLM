# Karpathy Rules

Principles from Andrej Karpathy's publicly shared philosophy on software and AI-assisted development. Applied here as a second lens alongside the gstack ethos.

---

## 1. Read the Code

LLMs generate plausible-looking code that is often subtly wrong. **Read every line before running it.** The diff is your responsibility the moment you accept it. "The LLM wrote it" is not a defense when it ships broken.

This applies double in Electron where a bug in main can silently kill the IPC bridge, a renderer bug can look like a main bug, and Ollama lifecycle errors surface as unhelpful blank screens.

---

## 2. Try It Before Theorizing

When in doubt about behavior — run it. Don't spend 20 minutes reasoning about what Ollama will do when a model is missing. Spin it up, remove a model, observe. The empirical answer is always cheaper than the theoretical one.

**Anti-pattern:** "I think this will fail because..." followed by a 200-line defensive wrapper. **Better:** Run it with a bad input. See what actually happens. Then write exactly the guard you need.

---

## 3. Less Code Is Better Code

The best code is code you didn't write. Before adding a utility, check if the runtime, framework, or an installed dep already does it. Shorter files are easier to audit, easier to test, easier to hand off to an LLM in a future session.

Every line you write is a line that can break, a line that must be read, a line that must be maintained. Delete aggressively.

---

## 4. Don't Vibe-Code Production Paths

"Vibe coding" (letting the LLM drive end-to-end with minimal review) is fine for throwaway prototypes. It is **not fine** for:
- Ollama process lifecycle (install, kill, crash recovery)
- Payment / subscription flows in the cloud backend
- API key generation and validation
- Anything that touches the user's filesystem

These paths get a full read, a test, and a mental walkthrough before they ship.

---

## 5. Regenerate Context, Don't Patch Confusion

When a session has gotten long and the LLM's suggestions start drifting or contradicting earlier decisions — **start a fresh session with the relevant files.** Don't try to correct a confused LLM mid-conversation. The context window is not a debugging tool. Regenerate it.

Practically: if you notice Claude suggesting something that contradicts a decision made 50 messages ago, stop, copy the relevant files and the core question into a new chat.

---

## 6. Software Is Eating AI (Not the Other Way Around)

LLMs are Software 3.0 — programs expressed in natural language instead of code. The engineering discipline still applies: version control, tests, code review, reproducibility. The new primitive is the prompt, but the old disciplines are how you don't ship disasters.

For this project: the system prompt to Ollama, the model alias mapping in `registry/models.json`, and the hardware tier logic in `system.js` are all "programs." Treat them with the same rigor as code. Test them. Version them. Review them before shipping.

---

## 7. The Iron Man Suit, Not the Autopilot

AI tools should make you more capable, not replace your judgment. The bear recommends the best model for the user's hardware. It does not decide for them silently. The gateway exposes the API. It does not call it on the user's behalf.

Every feature that takes action in the background (auto-upgrade, auto-update, Ollama restart) needs an explicit user acknowledgment flow. Respect user sovereignty. The bear guides — it does not control.

---

## 8. The Bitter Lesson in Miniature

Hardware always wins eventually. Ollama's value is that it compiles down to hardware-native inference (MLX on Apple Silicon, CUDA on Nvidia). Don't abstract away from that. The model tier system in `system.js` should stay close to the metal: detect GPU VRAM, detect unified memory, map to quantization tiers directly. Don't paper over the hardware with generic "performance levels" that hide what's actually happening.

---

## Together with gstack

| Karpathy | gstack |
|---|---|
| Read the code | Boil the lake (do the complete thing) |
| Try it before theorizing | Search before building |
| Less code is better | Completeness is cheap (but not complexity) |
| Don't vibe-code production | Review checklist before every push |
| Iron Man suit, not autopilot | User sovereignty |

The two sets reinforce each other. Karpathy keeps you skeptical and empirical. gstack keeps you thorough and complete. Together: build the right thing, completely, with your eyes open.
