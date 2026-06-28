#!/usr/bin/env node
/**
 * Aspen model recorder — always-on evidence collector for the "Loading <model>
 * into memory…" drops. Zero deps. Polls Ollama every 15s and logs, to a file you
 * can share, exactly what's resident, whether it's pinned, system memory, and —
 * the important part — a detailed EVENT the moment a model disappears, with the
 * before/after so we can see WHAT evicted it (a 3rd model, memory pressure, an
 * Ollama restart, or a keep_alive downgrade). No more guessing.
 *
 *   node scripts/model-recorder.js
 *
 * Writes ~/aspen-model-recorder.log (override with RECORDER_LOG=/path).
 * Leave it running. When you next see "Loading…", send me the log.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OLLAMA = { host: '127.0.0.1', port: 11434 };
const GATEWAY = { host: '127.0.0.1', port: Number(process.env.GATEWAY_PORT || 4000) };
const POLL_MS = Number(process.env.RECORDER_POLL_MS || 15000);
const LOG = process.env.RECORDER_LOG || path.join(os.homedir(), 'aspen-model-recorder.log');
const YEAR = 365 * 24 * 3600 * 1000;

function out(line) {
  const s = `${new Date().toISOString()} ${line}`;
  console.log(s);
  try { fs.appendFileSync(LOG, s + '\n'); } catch {}
}

function getJson(opts, body) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const req = http.request({ ...opts, method: body ? 'POST' : 'GET', timeout: 8000,
      headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {} },
      (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => {
        let j = null; try { j = JSON.parse(d); } catch {}
        resolve({ ok: res.statusCode < 400, status: res.statusCode, json: j, ms: Date.now() - t0 });
      }); });
    req.on('error', (e) => resolve({ ok: false, error: e.code || e.message, ms: Date.now() - t0 }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout', ms: Date.now() - t0 }); });
    if (body) req.write(body);
    req.end();
  });
}

function memInfo() {
  try {
    const m = fs.readFileSync('/proc/meminfo', 'utf8');
    const grab = (k) => Math.round((Number((m.match(new RegExp(k + ':\\s+(\\d+)')) || [])[1]) || 0) / 1024 / 1024 * 10) / 10;
    return { totalGB: grab('MemTotal'), availGB: grab('MemAvailable') };
  } catch { return { totalGB: Math.round(os.totalmem() / 1e9), availGB: Math.round(os.freemem() / 1e9) }; }
}

function pinState(expires_at) {
  if (!expires_at) return 'unknown';
  const ms = new Date(expires_at).getTime() - Date.now();
  if (ms > YEAR) return 'pinned';            // keep_alive:-1
  if (ms <= 0) return 'expired';
  return `${Math.round(ms / 60000)}m-left`;  // FINITE keep_alive — a downgrade
}

let prev = null;          // last resident map: name -> {pin}
let ollamaWasUp = true;

async function tick() {
  const ps = await getJson({ ...OLLAMA, path: '/api/ps' });
  const gw = await getJson({ ...GATEWAY, path: '/v1/models' });
  const mem = memInfo();

  // Ollama restart detection
  if (!ps.ok && ollamaWasUp) { out(`!! OLLAMA UNREACHABLE (${ps.error || ps.status}) — engine may be restarting`); ollamaWasUp = false; }
  if (ps.ok && !ollamaWasUp) { out('** OLLAMA BACK UP — it restarted; every model was unloaded by the restart'); ollamaWasUp = true; prev = null; }
  if (!ps.ok) { return; }

  const models = ps.json?.models || [];
  const cur = {};
  for (const m of models) cur[m.name] = { pin: pinState(m.expires_at), vramGB: Math.round((m.size_vram || 0) / 1e9 * 10) / 10 };

  const names = Object.keys(cur);
  const status = names.length
    ? names.map((n) => `${n}(${cur[n].vramGB}GB,${cur[n].pin})`).join(' ')
    : '(none resident)';
  const gwStr = gw.ok ? `${gw.ms}ms` : `DOWN(${gw.error || gw.status})`;
  out(`resident=[${status}] mem=${mem.availGB}/${mem.totalGB}GB-free gw=${gwStr}`);

  if (prev) {
    // Something got EVICTED
    for (const n of Object.keys(prev)) {
      if (!cur[n]) {
        const appeared = names.filter((x) => !prev[x]);
        let cause = 'unloaded with no replacement → idle/keep_alive expiry or MEMORY PRESSURE';
        if (appeared.length) cause = `DISPLACED by a new model loading: ${appeared.join(', ')} (hit OLLAMA_MAX_LOADED_MODELS)`;
        out(`>>> EVICTED: ${n}. ${cause}. mem-free=${mem.availGB}GB. resident-now=[${status}]`);
      }
    }
    // keep_alive DOWNGRADE (pinned -> finite) — something sent a finite keep_alive
    for (const n of names) {
      if (prev[n] && prev[n].pin === 'pinned' && cur[n].pin !== 'pinned' && cur[n].pin !== 'unknown') {
        out(`>>> KEEP_ALIVE DOWNGRADE: ${n} was pinned, now ${cur[n].pin}. A request sent a FINITE keep_alive for this model.`);
      }
    }
    // a NEW model appeared
    for (const n of names) if (!prev[n]) out(`+++ LOADED: ${n} (${cur[n].vramGB}GB, ${cur[n].pin})`);
  }
  prev = cur;
}

out(`=== Aspen model recorder started === poll=${POLL_MS / 1000}s log=${LOG} ollama=${OLLAMA.host}:${OLLAMA.port} gw=${GATEWAY.host}:${GATEWAY.port}`);
tick();
setInterval(tick, POLL_MS);
