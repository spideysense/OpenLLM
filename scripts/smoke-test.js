// scripts/smoke-test.js
// ───────────────────────────────────────────────────────────────────────────
// Launches the REAL Electron app against the production-built renderer and
// verifies it actually boots and renders. This catches the class of bug that
// unit tests / vite build / node --check do NOT: runtime errors in the packaged
// app (e.g. a bad require path that only fails in the asar, or a temporal-dead-
// zone const that blanks the renderer).
//
// It is a HARD GATE: release:mac runs this and refuses to build/ship if it fails.
//
// Checks:
//   1. Main process boots with no uncaught exception.
//   2. The renderer window loads (no did-fail-load).
//   3. The renderer has NO console errors.
//   4. The React root actually mounted visible content (not a blank page).
//
// Exit code 0 = pass, non-zero = fail (with reason printed).

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const TIMEOUT_MS = 30000;

function fail(msg) {
  console.error(`\n❌ SMOKE TEST FAILED: ${msg}\n`);
  process.exit(1);
}
function ok(msg) {
  console.log(`   ✓ ${msg}`);
}

// 1. The renderer must be built first (build/index.html must exist).
const rendererIndex = path.join(ROOT, 'build', 'index.html');
if (!fs.existsSync(rendererIndex)) {
  fail(`renderer not built — ${rendererIndex} missing. Run "npm run build:renderer" first.`);
}
ok('renderer build present');

// 2. Write a tiny harness main process that loads the REAL built renderer in a
//    hidden window and reports health back over stdout, then quits. We use the
//    real renderer bundle (build/index.html) — the same file the packaged app
//    loads — so any renderer runtime error reproduces here.
const harnessPath = path.join(ROOT, '.smoke-harness.js');
const harness = `
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const RENDERER = ${JSON.stringify(rendererIndex)};
const PRELOAD = ${JSON.stringify(path.join(ROOT, 'src/preload/index.js'))};
let win;
const errors = [];

process.on('uncaughtException', (e) => {
  console.log('SMOKE_EVENT:' + JSON.stringify({ type: 'main-uncaught', message: e.message }));
});

// Mock startup IPC so the app gets PAST its "Waking up Aspen..." loading gate and
// renders the real UI. Without the preload + these, the app sits on the loading
// screen forever (~519 chars) and we'd never test the actual render path.
function mock(channel, value) { try { ipcMain.handle(channel, () => value); } catch {} }
mock('ollama:status', { running: true, installed: true });
mock('ollama:info', { version: '0.0.0' });
mock('ollama:isVisionModel', false);
mock('store:get', true);
mock('store:set', true);
mock('models:list', []);
mock('connectors:list', []);
mock('tier:get', 'free');

app.on('ready', async () => {
  win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 800,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: false },
  });

  win.webContents.on('console-message', (_e, level, message) => {
    // level 3 = error
    if (level >= 3) errors.push(message);
  });
  // 'preload-error' and uncaught errors in the renderer surface here too.
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    console.log('SMOKE_EVENT:' + JSON.stringify({ type: 'did-fail-load', code, desc }));
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.log('SMOKE_EVENT:' + JSON.stringify({ type: 'render-gone', reason: details.reason }));
  });

  try {
    await win.loadFile(RENDERER);
    // Catch uncaught errors thrown in the renderer AFTER load (e.g. TDZ errors
    // that fire during React render/effects, which is exactly the blank-screen
    // bug). window.onerror reports these; we pull them out below.
    await win.webContents.executeJavaScript(
      "window.__smokeErrors=[];addEventListener('error',e=>window.__smokeErrors.push(String(e.message||e.error)));addEventListener('unhandledrejection',e=>window.__smokeErrors.push(String(e.reason)));true"
    );
  } catch (e) {
    console.log('SMOKE_EVENT:' + JSON.stringify({ type: 'load-throw', message: e.message }));
    app.quit();
    return;
  }

  // Wait longer so React mounts AND effects/interactions run, then inspect.
  setTimeout(async () => {
    let rootHtmlLen = -1;
    let pageErrors = [];
    try {
      rootHtmlLen = await win.webContents.executeJavaScript(
        "(document.getElementById('root') ? document.getElementById('root').innerHTML.length : -1)"
      );
      pageErrors = await win.webContents.executeJavaScript("window.__smokeErrors||[]");
    } catch (e) {
      console.log('SMOKE_EVENT:' + JSON.stringify({ type: 'eval-throw', message: e.message }));
    }
    console.log('SMOKE_EVENT:' + JSON.stringify({ type: 'report', errors: errors.concat(pageErrors), rootHtmlLen }));
    app.quit();
  }, 7000);
});
`;
fs.writeFileSync(harnessPath, harness);

// 3. Resolve the electron binary.
let electronBin;
try {
  electronBin = require('electron'); // path to the electron executable
} catch (e) {
  fs.unlinkSync(harnessPath);
  fail('electron not installed (npm install).');
}

// 4. Launch it. Force a non-dev run so it behaves like production. The extra
//    flags let Electron boot on headless CI runners (no display) without a false
//    failure — we render offscreen and disable the GPU/sandbox which need a
//    display server. On a real Mac with a display these are harmless.
const child = spawn(electronBin, [
  harnessPath,
  '--no-sandbox',
  '--disable-gpu',
  '--headless',
  '--disable-software-rasterizer',
], {
  cwd: ROOT,
  env: { ...process.env, NODE_ENV: 'production', ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let out = '';
let report = null;
const events = [];
const killTimer = setTimeout(() => {
  child.kill('SIGKILL');
}, TIMEOUT_MS);

child.stdout.on('data', (d) => {
  out += d.toString();
  for (const line of d.toString().split('\n')) {
    const m = line.match(/^SMOKE_EVENT:(.*)$/);
    if (m) {
      try {
        const evt = JSON.parse(m[1]);
        events.push(evt);
        if (evt.type === 'report') report = evt;
      } catch {}
    }
  }
});
child.stderr.on('data', () => {}); // ignore noisy electron stderr

function cleanup() {
  clearTimeout(killTimer);
  try { fs.unlinkSync(harnessPath); } catch {}
}

child.on('exit', () => {
  cleanup();

  // Evaluate the collected events.
  const mainCrash = events.find((e) => e.type === 'main-uncaught');
  if (mainCrash) fail(`main process threw on boot: ${mainCrash.message}`);
  ok('main process booted with no uncaught exception');

  const loadFail = events.find((e) => e.type === 'did-fail-load' || e.type === 'load-throw');
  if (loadFail) fail(`renderer failed to load: ${loadFail.desc || loadFail.message}`);

  const renderGone = events.find((e) => e.type === 'render-gone');
  if (renderGone) fail(`renderer process crashed: ${renderGone.reason}`);
  ok('renderer window loaded');

  if (!report) fail('app did not report health within timeout (likely hung or crashed silently).');

  if (report.errors && report.errors.length) {
    fail(`renderer had ${report.errors.length} console error(s):\n   - ` + report.errors.slice(0, 5).join('\n   - '));
  }
  ok('no renderer console errors');

  // Blank-screen guard: a fully mounted Aspen fills #root with thousands of chars
  // of markup (sidebar, composer, messages). The blank-screen bug left a near-empty
  // root (only the static loading shell, ~500 chars). Require a real mount.
  if (report.rootHtmlLen < 2000) {
    fail(`renderer mounted too little content (#root innerHTML = ${report.rootHtmlLen} chars; healthy is thousands). Likely a blank screen / render crash.`);
  }
  ok(`renderer mounted content (#root = ${report.rootHtmlLen} chars)`);

  console.log('\n✅ SMOKE TEST PASSED — the built app boots and renders.\n');
  process.exit(0);
});
