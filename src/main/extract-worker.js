// Isolate untrusted document parsers from the gateway event loop and cap time /
// V8 heap use. This is a resource boundary, not an OS sandbox for hostile code.
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
if (!isMainThread) {
  require('./file-extract').extractText(workerData).then(result => parentPort.postMessage(result)).catch(() => parentPort.postMessage({ ok: false, error: 'Document extraction failed' }));
}
let running = 0;
function extract(input) {
  if (running >= 2) return Promise.reject(new Error('Two documents are being imported. Try again when they finish.'));
  running++;
  return new Promise((resolve, reject) => {
    let worker;
    try { worker = new Worker(__filename, { workerData: input, resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 } }); }
    catch (e) { running--; reject(e); return; }
    let settled = false;
    const done = (err, value) => { if (settled) return; settled = true; clearTimeout(timer); running--; worker.terminate(); err ? reject(err) : resolve(value); };
    const timer = setTimeout(() => done(new Error('Document extraction took too long')), 20000);
    worker.once('message', value => done(null, value));
    worker.once('error', error => done(error));
    worker.once('exit', () => done(new Error('Document parser stopped unexpectedly')));
  });
}
module.exports = { extract };
