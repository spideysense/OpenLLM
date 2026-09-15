const http = require('http');
const context = require('./execution-context');
module.exports = {
  ...http,
  request(options, callback) {
    context.check();
    return http.request({ ...options, signal: context.signal() }, callback);
  }
};
