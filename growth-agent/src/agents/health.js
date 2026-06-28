// Aspen treating itself. Runs health checks on the box and files a proposal when
// something regressed — most notably the "Loading <model> into memory" issue:
// the active model must be RESIDENT and PINNED (keep_alive:-1 => far-future
// expiry). If it isn't, the next message cold-loads ~23GB and the user sees the
// dreaded loading message. This is the automated regression guard for the fix we
// shipped (keep_alive:-1 on chat+warm paths, keepSet in model-manager).
import { ollamaState, gatewayHealth } from '../collectors/ollama.js';
import { cfg } from '../config.js';
import { propose } from '../proposals.js';
import { push } from '../store.js';
import { log } from '../log.js';

const YEAR = 365 * 24 * 3600 * 1000;

export async function runHealth() {
  const st = await ollamaState();
  const gw = await gatewayHealth();
  const issues = [];

  if (!st.reachable) {
    issues.push({ sev: 'high', area: 'ollama', msg: `Ollama not reachable at ${cfg.ops.ollamaUrl}.` });
  } else {
    const active = cfg.ops.activeModel || st.resident[0]?.name;
    const res = active ? st.resident.find((m) => m.name === active) : null;
    if (active && !res) {
      issues.push({ sev: 'high', area: 'model-residency',
        msg: `Active model "${active}" is NOT resident. The next message will cold-load it ("Loading ${active} into memory"). Likely an eviction regression — verify keep_alive:-1 on the chat AND warm paths (ollama.js) and the keepSet pin in model-manager.js.` });
    } else if (res) {
      const exp = res.expires_at ? new Date(res.expires_at).getTime() : 0;
      if (exp - Date.now() < YEAR) {
        issues.push({ sev: 'high', area: 'model-pinning',
          msg: `Active model "${active}" is resident but NOT pinned (expires_at=${res.expires_at}). It will unload on idle and the next message shows "Loading ${active} into memory". Ensure keep_alive:-1 (not a finite duration) on every load path.` });
      }
    }
  }
  if (!gw.ok) issues.push({ sev: 'high', area: 'gateway', msg: `Gateway not responding at ${cfg.ops.gatewayUrl} (${gw.error || gw.status}).` });
  else if (gw.latencyMs > 8000) issues.push({ sev: 'med', area: 'latency', msg: `Gateway first-byte slow: ${gw.latencyMs}ms (possible cold load or contention).` });

  const snap = { reachable: st.reachable, resident: st.resident.map((m) => m.name), gateway: gw.ok, latencyMs: gw.latencyMs, issues: issues.length };
  push('health', snap);

  if (issues.length) {
    propose({
      tactic: 'ops_health', title: `Health: ${issues.length} issue(s) — ${issues.map((i) => i.area).join(', ')}`,
      estImpact: 0,
      body: issues.map((i) => `[${i.sev.toUpperCase()}] ${i.area}\n${i.msg}`).join('\n\n'),
      meta: { issues, snap },
    });
  }
  log(`health: ${issues.length ? issues.length + ' issue(s)' : 'all green'} · resident=[${snap.resident.join(', ')}] · gw=${gw.ok ? gw.latencyMs + 'ms' : 'DOWN'}`);
  return { snap, issues };
}
