#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/mission-status.js — is a background mission freaking out the box?
// Reads Aspen's persisted mission state (electron-store config.json) directly —
// no server, no API key. Shows each mission's status, step count, how long since
// its last step, flags for tight loops / runaway length, and the latest journal.
//
// USAGE
//   node scripts/mission-status.js                 # one-shot
//   node scripts/mission-status.js --watch         # refresh every 2s
//   node scripts/mission-status.js /path/config.json   # explicit config path

const fs = require('fs');
const path = require('path');
const os = require('os');

const explicit = process.argv.find((a) => a.endsWith('.json'));
const candidates = [
  explicit,
  path.join(os.homedir(), '.config', 'Aspen', 'config.json'),
  path.join(os.homedir(), '.config', 'aspen', 'config.json'),
  path.join(os.homedir(), 'Library', 'Application Support', 'Aspen', 'config.json'),
  path.join(os.homedir(), 'Library', 'Application Support', 'aspen', 'config.json'),
  path.join(os.homedir(), '.aspen', 'config.json'),
].filter(Boolean);

function findConfig() {
  return candidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
}

function fmtAgo(t) {
  if (!t) return 'never';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  return Math.round(s / 3600) + 'h ago';
}

function render() {
  const file = findConfig();
  if (!file) {
    console.error('Could not find Aspen config.json. Tried:\n  ' + candidates.join('\n  '));
    console.error('Pass it explicitly:  node scripts/mission-status.js /path/to/config.json');
    process.exit(1);
  }
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.error('Could not parse', file, '—', e.message); process.exit(1); }

  const missions = Array.isArray(data.missions) ? data.missions : [];
  const now = new Date().toLocaleTimeString();
  console.log(`\n=== Aspen missions @ ${now} ===`);
  console.log(`source: ${file}`);
  const active = missions.filter((m) => m.status === 'active').length;
  console.log(`${missions.length} total · ${active} active\n`);

  if (!missions.length) { console.log('(no missions)\n'); return; }

  for (const m of missions) {
    const steps = (m.journal || []).length;
    const since = m.lastStep ? Date.now() - m.lastStep : null;
    const flags = [];
    if (m.status === 'active' && since !== null && since < 5000) flags.push('⚠  stepping <5s apart — possible tight loop');
    if (m.status === 'active' && steps >= 100) flags.push('⚠  ' + steps + ' steps — runaway length, consider stopping');
    if (m.status === 'active' && since !== null && since > 15 * 60 * 1000) flags.push('⚠  no step in >15m — may be stalled/blocked');

    console.log(`● ${(m.status || '?').toUpperCase()}  [${m.id}]`);
    console.log(`  goal:   ${String(m.goal || '').replace(/\s+/g, ' ').slice(0, 110)}`);
    console.log(`  steps:  ${steps}   last: ${fmtAgo(m.lastStep)}   created: ${fmtAgo(m.created)}`);
    for (const f of flags) console.log('  ' + f);
    const tail = (m.journal || []).slice(-2);
    if (tail.length) {
      console.log('  latest:');
      for (const j of tail) {
        const txt = typeof j === 'string' ? j : (j && (j.text || j.summary)) || JSON.stringify(j);
        console.log('    · ' + String(txt).replace(/\s+/g, ' ').slice(0, 140));
      }
    }
    console.log('');
  }
  console.log('Stop one from the app (⚡ Missions) or ask Aspen: "stop mission <id>".\n');
}

if (process.argv.includes('--watch')) {
  const tick = () => { process.stdout.write('\x1Bc'); render(); }; // clear screen
  tick();
  setInterval(tick, 2000);
} else {
  render();
}
