'use strict';
// Exercise the real household server and UI in an isolated Electron window.
// No saved household, microphone, model download or connected device is used.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aspen-home-smoke-'));
const harnessPath = path.join(root, '.smoke-home-harness.js');
const harness = `
const { app, BrowserWindow } = require('electron');
const { createHomeServer } = require('./src/home/server');
let home, win;
const errors = [];
process.on('uncaughtException', e => { errors.push(e.message); app.exit(1); });
app.whenReady().then(async () => {
  try {
    home = await createHomeServer({port:0, dataDir:${JSON.stringify(dir)}});
    win = new BrowserWindow({show:false,width:1200,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
    win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
    win.webContents.on('render-process-gone', (_event, details) => errors.push(details.reason));
    win.webContents.on('did-fail-load', (_event, code, description) => errors.push(description));
    await win.loadURL(home.url);
    await win.webContents.executeJavaScript(
      '(' + ${JSON.stringify(async function () {
        const waitFor = async selector => {
          const until = Date.now() + 10000;
          while (Date.now() < until) { const el = document.querySelector(selector); if (el) return el; await new Promise(r => setTimeout(r, 100)); }
          throw new Error('Household screen did not render: ' + selector);
        };
        const form = await waitFor('#account-form');
        form.elements.homeName.value = 'Release test home';
        form.elements.name.value = 'Release tester';
        form.elements.password.value = 'isolated release test password';
        form.requestSubmit();
        await waitFor('.sidebar');
        if (!document.querySelector('h1').textContent.includes('Release tester')) throw new Error('Owner setup did not finish');
        document.querySelector('[data-action="task-add"]').click();
        const task = await waitFor('#task-form');
        task.elements.title.value = 'Release test reminder';
        task.requestSubmit();
        const until = Date.now() + 10000;
        while (Date.now() < until && !document.body.textContent.includes('Release test reminder')) await new Promise(r => setTimeout(r, 100));
        if (!document.body.textContent.includes('Release test reminder')) throw new Error('New household task did not appear');
        if (typeof window.require !== 'undefined') throw new Error('Node APIs exposed to household window');
        return true;
      }.toString())} + ')()'
    );
    if (errors.length) throw new Error(errors.join('; '));
    console.log('ASPEN_HOME_SMOKE_OK');
    await home.close(); home = null; app.quit();
  } catch(e) {
    console.error('Household smoke failed: ' + e.message);
    if(home) await home.close(); app.exit(1);
  }
});
`;
fs.writeFileSync(harnessPath, harness);
let child, output = '', errors = '';
function clean() { fs.rmSync(harnessPath, { force: true }); fs.rmSync(dir, { recursive: true, force: true }); }
try {
  const env = { ...process.env, NODE_ENV: 'production', ELECTRON_DISABLE_SECURITY_WARNINGS: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(require('electron'), [harnessPath, '--disable-gpu'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) { clean(); console.error(e.message); process.exit(1); }
const timeout = setTimeout(() => child.kill('SIGKILL'), 45000);
child.stdout.on('data', chunk => { output += chunk; });
child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-6000); });
child.on('error', error => { clearTimeout(timeout); clean(); console.error(error.message); process.exitCode = 1; });
child.on('exit', code => {
  clearTimeout(timeout); clean();
  if (code !== 0 || !output.includes('ASPEN_HOME_SMOKE_OK')) { console.error('Household release check failed.\n' + errors); process.exitCode = 1; }
  else console.log('Household release check passed: owner setup, saved task, and isolated UI.');
});
