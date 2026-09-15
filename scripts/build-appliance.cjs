// Produces a service-only distribution including Node and production modules.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[2] || 'dist');
if (process.platform !== 'linux') throw new Error('Build Linux appliances on Linux');
if (!fs.existsSync(path.join(root, 'build-household/index.html'))) throw new Error('Build the household UI first');
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'aspen-package-'));
try {
  const app = path.join(staging, 'aspen'); fs.mkdirSync(app);
  for (const name of ['src/main', 'registry', 'skills', 'scripts', 'shared', 'integrations', 'docs', 'build-household', 'package.json', 'package-lock.json']) {
    const src = path.join(root, name), dest = path.join(app, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, dest, { recursive: true });
  }
  fs.mkdirSync(path.join(app, 'runtime'));
  fs.copyFileSync(process.execPath, path.join(app, 'runtime/node')); fs.chmodSync(path.join(app, 'runtime/node'), 0o755);
  execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-fund'], { cwd: app, stdio: 'inherit' });
  const manifest = {
    format: 'aspen-appliance-v1', version: require('../package.json').version,
    platform: process.platform, arch: process.arch, node: process.version,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    dirty: !!execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
  };
  fs.writeFileSync(path.join(app, 'appliance-manifest.json'), JSON.stringify(manifest, null, 2));
  // Exercise the actual packaged service using its bundled runtime and modules.
  execFileSync(path.join(app, 'runtime/node'), [path.join(app, 'scripts/verify-enrollment.cjs')], { cwd: app, stdio: 'inherit' });
  fs.mkdirSync(output, { recursive: true });
  const target = path.join(output, `Aspen-appliance-linux-${process.arch}.tar.gz`);
  if (fs.existsSync(target)) throw new Error('Output already exists; choose a new output directory');
  execFileSync('tar', ['-czf', target, '-C', staging, 'aspen']);
  console.log(`Service distribution created: ${target}`);
} finally { fs.rmSync(staging, { recursive: true, force: true }); }
