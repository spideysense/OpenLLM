/**
 * Render a page WITH JavaScript and return its visible text.
 *
 * Why this exists: fetch_url does a plain HTTP GET, so anything client-rendered
 * (React/Next SPAs, dashboards, puzzle viewers like arcprize.org) comes back as
 * an empty JS shell. The model then flails, retrying URL variations, because the
 * page "has no text". This loads the URL in a real browser and reads what a
 * person would actually see.
 *
 * Why not Playwright: Electron IS Chromium — we already ship it. Playwright would
 * download a second copy of the same engine (~300MB) onto an appliance that also
 * downloads Ollama and a 24GB model on first run. This adds zero bytes.
 *
 * Swappable by design: renderPage(url) is the whole contract. If we ever want a
 * separate process tree for isolation, replace this body with a Playwright call
 * and nothing upstream changes.
 *
 * Hostile-page posture: fetch_url takes attacker-influenceable URLs from any key
 * (including family/guest), so the window is locked down — sandbox on, node
 * integration off, context isolation on, images off, no persisted session, no
 * popups/downloads/permissions, hard timeout, and the window is always destroyed.
 */
'use strict';

const RENDER_TIMEOUT_MS = 15000; // hard ceiling on a single render
const SETTLE_POLL_MS = 400;      // how often we re-read the text while it paints
const SETTLE_MAX_MS = 8000;      // stop waiting for the SPA to settle after this
const MIN_USEFUL_CHARS = 200;    // below this we keep waiting for content

/**
 * Electron is only present inside the app; tests/CLI run this file in plain node,
 * where require('electron') hits the npm shim (which can try to DOWNLOAD a binary).
 * Gate on process.versions.electron so that never happens outside the app.
 */
function getElectron() {
  if (!process.versions || !process.versions.electron) return null;
  try { return require('electron'); } catch { return null; }
}

/**
 * @returns {Promise<string|null>} rendered visible text, or null if we couldn't
 * render (no Electron, no display, timeout, load failure) so the caller can fall
 * back to the plain-HTTP text it already has.
 */
async function renderPage(url, { timeoutMs = RENDER_TIMEOUT_MS } = {}) {
  const electron = getElectron();
  if (!electron || !electron.app || !electron.BrowserWindow) return null;
  const { app, BrowserWindow, session } = electron;
  if (!app.isReady()) return null;

  let win = null;
  let timer = null;
  try {
    // Throwaway in-memory session (no "persist:" prefix) — nothing this page does
    // touches the user's cookies, storage, or cache.
    const partition = 'aspen-render-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const ses = session.fromPartition(partition, { cache: false });
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    ses.setPermissionCheckHandler(() => false);

    win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        partition,
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
        images: false,          // we only want text; skipping images is much faster
        webgl: false,
        backgroundThrottling: false,
      },
    });

    // A hostile page must not be able to spawn windows or start downloads.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    ses.on('will-download', (e) => e.preventDefault());

    const result = await new Promise((resolve) => {
      let settled = false;
      const finish = (v) => { if (!settled) { settled = true; resolve(v); } };

      timer = setTimeout(() => finish(null), timeoutMs);

      win.webContents.on('did-fail-load', (_e, code, desc) => {
        // -3 is ABORTED, which fires on ordinary redirects — not a real failure.
        if (code !== -3) finish(null);
      });

      win.webContents.on('did-finish-load', async () => {
        try {
          // SPAs paint after load, so read repeatedly until the text stops growing.
          const started = Date.now();
          let last = '';
          let stableFor = 0;
          for (;;) {
            const text = await win.webContents.executeJavaScript(
              'document.body ? document.body.innerText : ""', true
            ).catch(() => '');
            const t = String(text || '').trim();
            if (t && t === last && t.length >= MIN_USEFUL_CHARS) {
              stableFor += SETTLE_POLL_MS;
              if (stableFor >= SETTLE_POLL_MS * 2) return finish(t); // steady twice
            } else {
              stableFor = 0;
            }
            last = t;
            if (Date.now() - started > SETTLE_MAX_MS) return finish(t || null);
            await new Promise((r) => setTimeout(r, SETTLE_POLL_MS));
          }
        } catch {
          finish(null);
        }
      });

      win.loadURL(url).catch(() => finish(null));
    });

    return result && result.trim() ? result.trim() : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
    try { if (win && !win.isDestroyed()) win.destroy(); } catch { /* ignore */ }
  }
}

module.exports = { renderPage, checkHtmlRuntime, RENDER_TIMEOUT_MS };

/**
 * Load generated HTML in a real browser and report anything it throws.
 *
 * publish_app's v1 check only proves the JavaScript PARSES. An app can parse
 * perfectly and still be dead on arrival — a ReferenceError on load, a null
 * canvas, a typo'd function name — and the user gets a blank page. This actually
 * runs it and collects the errors so the model can fix them before publishing.
 *
 * @returns {Promise<{ok:true,skipped?:boolean}|{ok:false,errors:string[]}>}
 *   skipped:true when we can't render (no Electron) — never block publishing then.
 */
async function checkHtmlRuntime(html, { timeoutMs = 12000, watchMs = 2500 } = {}) {
  const electron = getElectron();
  if (!electron || !electron.app || !electron.BrowserWindow) return { ok: true, skipped: true };
  const { app, BrowserWindow, session } = electron;
  if (!app.isReady()) return { ok: true, skipped: true };

  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  // Load from a temp file, not a data: URL — file:// behaves like a real page,
  // so canvas/DOM APIs work the same way they will for the user.
  const tmp = path.join(os.tmpdir(), `aspen-validate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html`);
  let win = null;
  let timer = null;
  try {
    fs.writeFileSync(tmp, html, 'utf8');

    const partition = 'aspen-validate-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const ses = session.fromPartition(partition, { cache: false });
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

    win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: { partition, sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    const errors = [];
    // Uncaught exceptions surface as console errors (level 3) in Chromium.
    win.webContents.on('console-message', (_e, level, message, line) => {
      if (level !== 3) return;
      const m = String(message || '');
      // Network/asset noise is not a code defect — don't fail a good app because
      // a CDN 404'd or the box is offline.
      if (/Failed to load resource|net::ERR_|favicon/i.test(m)) return;
      errors.push(line ? `${m} (line ${line})` : m);
    });
    win.webContents.on('render-process-gone', (_e, d) => {
      errors.push(`The page crashed while loading (${(d && d.reason) || 'unknown'}).`);
    });

    await new Promise((resolve) => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(); } };
      timer = setTimeout(finish, timeoutMs);
      win.webContents.on('did-fail-load', (_e, code) => { if (code !== -3) finish(); });
      // Watch briefly after load — errors in requestAnimationFrame/timers land here.
      win.webContents.on('did-finish-load', () => setTimeout(finish, watchMs));
      win.loadFile(tmp).catch(finish);
    });

    return errors.length ? { ok: false, errors } : { ok: true };
  } catch {
    return { ok: true, skipped: true }; // never block publishing on our own failure
  } finally {
    if (timer) clearTimeout(timer);
    try { if (win && !win.isDestroyed()) win.destroy(); } catch { /* ignore */ }
    try { require('fs').unlinkSync(tmp); } catch { /* ignore */ }
  }
}
