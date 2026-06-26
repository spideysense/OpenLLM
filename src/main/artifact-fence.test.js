const { makeArtifactFencer } = require('./artifact-fence');

// Run `input` through a fresh fencer, splitting into deltas of size `chunk`
// (0 = whole-string, 1 = char-by-char). Returns the full normalized output.
function run(input, chunk) {
  const fz = makeArtifactFencer();
  let out = '';
  if (chunk <= 0) { out += fz.push(input); }
  else { for (let i = 0; i < input.length; i += chunk) out += fz.push(input.slice(i, i + chunk)); }
  out += fz.end();
  return out;
}
// A normalizer must be invariant to how the stream is chunked.
function stable(input) {
  const ref = run(input, 0);
  for (const ch of [1, 2, 3, 5, 7, 13]) {
    const got = run(input, ch);
    if (got !== ref) throw new Error(`chunk-instability @${ch}\n--ref--\n${JSON.stringify(ref)}\n--got--\n${JSON.stringify(got)}`);
  }
  return ref;
}

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('  ✗ ' + name); } }

const FIG = '<figure style="m">\n  <img src="https://x/y.jpg" alt="a">\n  <figcaption>cap</figcaption>\n</figure>';

// 1. plain prose unchanged + chunk-stable
{
  const s = 'Here is a normal answer.\nIt spans two lines and has 5 < 7 and a<b inline.\n';
  const o = stable(s);
  check('prose unchanged', o === s);
}
// 2. bare figure gets fenced
{
  const s = 'Here you go!\n' + FIG + '\n';
  const o = stable(s);
  check('bare figure wrapped opens', o.includes('```html\n<figure'));
  check('bare figure wrapped closes', o.includes('</figure>\n```'));
  check('bare figure keeps prose', o.startsWith('Here you go!\n'));
}
// 3. already-fenced figure NOT double-wrapped
{
  const s = 'Here:\n```html\n' + FIG + '\n```\n';
  const o = stable(s);
  check('already fenced unchanged', o === s);
  check('no double fence', (o.match(/```html/g) || []).length === 1);
}
// 4. js code block with < lines untouched (inside model fence)
{
  const s = 'Look:\n```js\nif (a < b) return <weird>;\nconst x = 1;\n```\nDone.\n';
  const o = stable(s);
  check('code block untouched', o === s);
}
// 5. single-line svg wrapped
{
  const s = '<svg width="10"><rect/></svg>\n';
  const o = stable(s);
  check('single-line svg fenced', o === '```html\n' + s + '```\n');
}
// 6. single img wrapped
{
  const s = '<img src="https://a/b.png">\n';
  const o = stable(s);
  check('single img fenced', o.startsWith('```html\n<img') && o.trimEnd().endsWith('```'));
}
// 7. non-artifact tag (<div>) NOT wrapped
{
  const s = '<div>hello</div>\n';
  const o = stable(s);
  check('div not wrapped', o === s);
}
// 8. figure with no trailing newline (stream ends mid-block) still closes
{
  const s = 'Pic:\n' + FIG; // no final newline
  const o = stable(s);
  check('eof figure opens fence', o.includes('```html\n<figure'));
  check('eof figure force-closes', o.trimEnd().endsWith('```'));
}
// 9. full html document wrapped
{
  const s = '<!doctype html>\n<html><body><h1>Card</h1></body></html>\n';
  const o = stable(s);
  check('doc fenced open', o.startsWith('```html\n<!doctype html>'));
  check('doc fenced close', o.includes('</html>\n```'));
}
// 10. prose, then fenced figure, then more prose — prose preserved
{
  const s = 'Top.\n```html\n' + FIG + '\n```\nBottom line.\n';
  const o = stable(s);
  check('mixed unchanged', o === s);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
