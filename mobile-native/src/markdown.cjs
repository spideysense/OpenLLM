const MarkdownIt = require('markdown-it');

// Model output is untrusted. Images can make network requests without a tap;
// HTML and automatic linkification are unnecessary in a private chat viewer.
const markdown = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
  maxNesting: 20,
}).disable('image');

module.exports = { markdown, MAX_MARKDOWN_LENGTH: 100_000 };
