const { test } = require('node:test');
const assert = require('node:assert/strict');
const { markdown } = require('../src/markdown.cjs');

function tokens(text) {
  return markdown.parse(text, {}).flatMap(token => [token, ...(token.children || [])]);
}

test('model replies cannot create image requests or raw HTML', () => {
  const output = tokens('![tracking](https://outside.example/pixel?secret=123)\n\n<img src="https://outside.example/pixel">');
  assert.ok(!output.some(token => ['image', 'html_inline', 'html_block'].includes(token.type)));
  assert.ok(output.some(token => token.type === 'text' && token.content.includes('tracking')));
});

test('ordinary formatting, tables, fences and explicit safe links still parse', () => {
  const output = tokens('**Bold** and [source](https://example.com)\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```js\nconst a = 1;\n```');
  for (const type of ['strong_open', 'link_open', 'table_open', 'fence']) {
    assert.ok(output.some(token => token.type === type), type);
  }
  assert.ok(!tokens('[bad](javascript:alert%281%29)').some(token => token.type === 'link_open'));
});

test('Xcode UUID override preserves project identifier generation', () => {
  const xcode = require('xcode');
  const project = xcode.project('/tmp/aspen-unused.xcodeproj/project.pbxproj');
  project.hash = { project: { objects: {} } };
  assert.match(project.generateUuid(), /^[A-F0-9]{24}$/);
});
