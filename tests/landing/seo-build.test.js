import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { canonicalizeOrigins, optimizeHomepage } from '../../scripts/seo-build.mjs';

const sourceHomepage = fs.readFileSync(path.resolve('site/index.html'), 'utf8');

describe('SEO deployment build', () => {
  it('targets the hostname users and crawlers actually land on', () => {
    const output = canonicalizeOrigins([
      'https://runonaspen.com/',
      'https://runonaspen.com/docs',
      'https://runonaspen.com/blog/post.html',
    ].join('\n'));

    expect(output).not.toContain('https://runonaspen.com');
    expect(output).toContain('https://www.runonaspen.com/');
    expect(output).toContain('https://www.runonaspen.com/docs');
  });

  it('publishes household positioning and remains idempotent', () => {
    const output = optimizeHomepage(sourceHomepage);
    expect(output).toContain('<title>Aspen — The private operating system for your home</title>');
    expect(output).toContain('<link rel="canonical" href="https://www.runonaspen.com/">');
    expect(output).toContain('"@type":"SoftwareApplication"');
    expect(output).toContain('Household developer preview');
    expect(optimizeHomepage(output)).toBe(output);
  });

  it('keeps canonical metadata, social metadata and structured data on one origin', () => {
    const output = optimizeHomepage(sourceHomepage);
    const head = output.slice(0, output.indexOf('</head>'));

    expect(head).not.toContain('https://runonaspen.com');
    expect(head).toContain('https://www.runonaspen.com');
  });

  it('is part of the Vercel production build', () => {
    const vercel = JSON.parse(fs.readFileSync(path.resolve('vercel.json'), 'utf8'));
    expect(vercel.buildCommand).toContain('node site/build.mjs');
    expect(vercel.buildCommand).toContain('node scripts/seo-build.mjs');
  });
});
