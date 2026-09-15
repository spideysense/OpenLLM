function normalize(name) {
  const value = String(name || '');
  if (!value) return '';
  return value.includes(':') ? value : value + ':latest';
}
module.exports = { normalize };
