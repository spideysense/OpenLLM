// Bound concurrent foreground work to the device budget. Waiters are cancellable.
let running = 0;
const queue = [];
const activeJobs = new Set();
function drain() {
  const limit = require('./system').getRuntimeBudget().parallel;
  while (running < limit && queue.length) {
    const item = queue.shift();
    item.signal?.removeEventListener('abort', item.cancel);
    if (item.signal?.aborted) {
      item.reject(item.signal.reason);
      continue;
    }
    running++;
    activeJobs.add(item);
    let released = false;
    item.resolve(() => {
      if (!released) {
        released = true;
        running--;
        activeJobs.delete(item);
        drain();
      }
    });
  }
}
function acquire(signal, { background = false, onPreempt } = {}) {
  signal?.throwIfAborted();
  if (queue.length >= 32)
    return Promise.reject(
      new Error('Aspen is busy. Please try again shortly.')
    );
  if (!background)
    for (const job of activeJobs) if (job.background) job.onPreempt?.();
  return new Promise((resolve, reject) => {
    const item = { resolve, reject, signal, background, onPreempt };
    item.cancel = () => {
      const i = queue.indexOf(item);
      if (i >= 0) queue.splice(i, 1);
      reject(signal.reason);
    };
    signal?.addEventListener('abort', item.cancel, { once: true });
    queue.push(item);
    queue.sort((a, b) => Number(a.background) - Number(b.background));
    drain();
  });
}
module.exports = { acquire };
