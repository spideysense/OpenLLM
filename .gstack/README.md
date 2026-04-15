# GStack Skills for OpenLLM Development

Adapted from [GStack](https://github.com/garrytan/gstack) by Garry Tan (MIT License).

## Core reading

| File | What it is |
|---|---|
| `ETHOS.md` | Builder philosophy — Boil the Lake, Search Before Building, User Sovereignty |
| `CLAUDE.md` | OpenLLM-specific commands, project structure, IPC architecture, CHANGELOG rules |
| `KARPATHY.md` | Andrej Karpathy's engineering principles applied to this project |

## When to use each skill

### Before building a feature → `plan-ceo-review.md`
- Is this the right thing to build?
- What's the 10-star version?
- Are we solving the real problem?

### Before writing code → `plan-eng-review.md`
- Architecture decisions (especially: does this require a new IPC channel?)
- Data flow, state transitions
- Edge cases, failure modes

### Before committing → `review.md` + `review-checklist.md`
- IPC bridge completeness
- Ollama lifecycle error handling
- LLM output trust boundaries
- Missing error handling
- Broken async/await patterns

### After shipping → `qa.md`
- Verify the feature works end-to-end (Electron + Ollama integration)
- Check affected pages
- Health score

### Weekly → `retro.md`
- What shipped, what broke
- Patterns to fix
- Velocity tracking
