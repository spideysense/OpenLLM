const { AsyncLocalStorage } = require('async_hooks');
const context = new AsyncLocalStorage();
function signal() {
  return context.getStore()?.signal;
}
function check() {
  signal()?.throwIfAborted();
  if (context.getStore()?.authorized && !context.getStore().authorized()) throw new Error('Device access revoked');
}
module.exports = { person: () => context.getStore()?.person || null, privateContext: () => context.getStore()?.privateContext === true, markPrivate: () => { const value = context.getStore(); if (value) value.privateContext = true; }, run: (value, fn) => context.run(value, fn), signal, check };
