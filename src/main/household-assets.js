const fs = require('fs');
const path = require('path');
function serve(req, res) {
  if (req.method !== 'GET') return false;
  let name;
  if (req.url === '/household' || req.url === '/household/') name = 'index.html';
  else if (/^\/household\/assets\/[a-zA-Z0-9_-]+\.(js|css)$/.test(req.url))
    name = req.url.slice('/household/'.length);
  else return false;
  const file = path.resolve(__dirname, '../../build-household', name);
  if (!fs.existsSync(file)) {
    res.writeHead(503);
    res.end('Build the household application before starting Aspen.');
    return true;
  }
  const type = name.endsWith('.js')
    ? 'text/javascript'
    : name.endsWith('.css')
      ? 'text/css'
      : 'text/html';
  const content = fs.readFileSync(file);
  res.writeHead(200, {
    'Content-Type': type + '; charset=utf-8',
    'Content-Length': content.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy':
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  });
  res.end(content);
  return true;
}
module.exports = { serve };
