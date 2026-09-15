const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Readable, Transform } = require('node:stream');
const { execFileSync } = require('node:child_process');
async function main() {
  const manifest = require('../registry/appliance-engine.json');
  const entry = manifest[`${process.platform}-${process.arch}`];
  if (!entry) throw new Error('Unsupported appliance architecture');
  const dest = path.resolve(__dirname, '../vendor/ollama');
  if (fs.existsSync(dest)) throw new Error('Engine already staged; replace it through a reviewed application upgrade');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const staging = fs.mkdtempSync(path.join(path.dirname(dest), '.engine-'));
  try {
    const response = await fetch(entry.url, { signal: AbortSignal.timeout(600000) });
    if (!response.ok) throw new Error(`Engine download failed (${response.status})`);
    const hash = crypto.createHash('sha256'); let bytes = 0;
    const archive = path.join(staging, 'engine.tar.zst');
    await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, _encoding, cb) {
      bytes += chunk.length; if (bytes > 2 * 1024 ** 3) return cb(new Error('Engine archive too large'));
      hash.update(chunk); cb(null, chunk);
    } }), fs.createWriteStream(archive, { flags: 'wx', mode: 0o600 }));
    if (hash.digest('hex') !== entry.sha256) throw new Error('Engine checksum mismatch; nothing installed');
    const unpacked = path.join(staging, 'unpacked'); fs.mkdirSync(unpacked);
    execFileSync('tar', ['--zstd', '--no-same-owner', '-xf', archive, '-C', unpacked]);
    if (!fs.existsSync(path.join(unpacked, 'bin/ollama'))) throw new Error('Invalid engine archive');
    fs.renameSync(unpacked, dest);
    console.log(`Pinned Ollama ${manifest.version} installed with verified SHA-256`);
  } finally { fs.rmSync(staging, { recursive: true, force: true }); }
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
