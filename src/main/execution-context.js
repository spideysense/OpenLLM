const { AsyncLocalStorage } = require('async_hooks');
const context = new AsyncLocalStorage();
function signal() {
  return context.getStore()?.signal;
}
function check() {
  signal()?.throwIfAborted();
}
module.exports = { run: (value, fn) => context.run(value, fn), signal, check };
