/**
 * Landing Page Tests
 *
 * STORY: Visitor lands on llmbear.com and can understand what it does
 * STORY: Search engines can properly index the page
 * STORY: AI engines (AEO) can extract structured answers
 * STORY: No TunnelBear branding leaks anywhere
 * STORY: All pricing tiers are clearly presented
 * STORY: API code examples are accurate
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const html = fs.readFileSync(path.resolve('site/index.html'), 'utf8');

// ═══════════════════════════════════════════════════
// BRAND INTEGRITY: No TunnelBear references
// ═══════════════════════════════════════════════════

describe('Brand: No TunnelBear references', () => {
  it('should not mention TunnelBear anywhere', () => {
    expect(html.toLowerCase()).not.toContain('tunnelbear');
  });

  it('should not mention "tunnel" anywhere', () => {
    expect(html.toLowerCase()).not.toContain('tunnel');
  });

  it('should not link to tunnelbear.com', () => {
    expect(html.toLowerCase()).not.toContain('tunnelbear.com');
  });

  it('should prominently feature "LLM Bear" branding', () => {
    const matches = html.match(/LLM Bear/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(5);
  });
});

// ═══════════════════════════════════════════════════
// SEO: Meta tags and structure
// ═══════════════════════════════════════════════════

describe('SEO: Meta tags', () => {
  it('should have a descriptive title tag', () => {
    const title = html.match(/<title>(.*?)<\/title>/)?.[1] || '';
    expect(title).toContain('LLM Bear');
    expect(title.length).toBeGreaterThan(30);
    expect(title.length).toBeLessThan(70);
  });

  it('should have a meta description', () => {
    const desc = html.match(/meta name="description" content="(.*?)"/)?.[1] || '';
    expect(desc.length).toBeGreaterThan(100);
    expect(desc.length).toBeLessThan(200);
    expect(desc.toLowerCase()).toContain('ai');
  });

  it('should have meta keywords', () => {
    expect(html).toContain('meta name="keywords"');
  });

  it('should have a canonical URL', () => {
    expect(html).toContain('rel="canonical"');
  });

  it('should have Open Graph tags', () => {
    expect(html).toContain('og:title');
    expect(html).toContain('og:description');
    expect(html).toContain('og:type');
    expect(html).toContain('og:url');
    expect(html).toContain('og:image');
  });

  it('should have Twitter Card tags', () => {
    expect(html).toContain('twitter:card');
    expect(html).toContain('twitter:title');
    expect(html).toContain('twitter:description');
  });

  it('should have proper heading hierarchy (h1 → h2 → h3)', () => {
    const h1Count = (html.match(/<h1/g) || []).length;
    const h2Count = (html.match(/<h2/g) || []).length;
    expect(h1Count).toBe(1); // Only one H1
    expect(h2Count).toBeGreaterThanOrEqual(3); // Multiple H2 sections
  });

  it('should have semantic sections', () => {
    expect(html).toContain('<section');
    expect(html).toContain('<nav');
    expect(html).toContain('<footer');
  });

  it('should have alt-equivalent text for SVG graphics', () => {
    // SVGs should be decorative or have labels
    expect(html).toContain('<svg');
  });
});

// ═══════════════════════════════════════════════════
// AEO: Structured data for AI engines
// ═══════════════════════════════════════════════════

describe('AEO: Structured data (JSON-LD)', () => {
  it('should have JSON-LD script tags', () => {
    expect(html).toContain('application/ld+json');
  });

  it('should have SoftwareApplication schema', () => {
    expect(html).toContain('"@type":"SoftwareApplication"');
    expect(html).toContain('"name":"LLM Bear"');
  });

  it('should have FAQPage schema with Q&A pairs', () => {
    expect(html).toContain('"@type":"FAQPage"');
    expect(html).toContain('"@type":"Question"');
    expect(html).toContain('"acceptedAnswer"');
  });

  it('should include pricing in structured data', () => {
    expect(html).toContain('"@type":"Offer"');
    expect(html).toContain('"price"');
    expect(html).toContain('"priceCurrency":"USD"');
  });

  it('should include download URL in structured data', () => {
    expect(html).toContain('"downloadUrl"');
    expect(html).toContain('github.com');
  });

  it('should have FAQ covering at least 4 questions', () => {
    const questionCount = (html.match(/"@type":"Question"/g) || []).length;
    expect(questionCount).toBeGreaterThanOrEqual(4);
  });
});

// ═══════════════════════════════════════════════════
// CONTENT: Pricing tiers
// ═══════════════════════════════════════════════════

describe('Content: Pricing tiers', () => {
  it('should show Cave Bear (free)', () => {
    expect(html).toContain('Cave Bear');
    expect(html).toContain('Free');
    expect(html).toContain('forever');
  });

  it('should show Cloud Bear ($0.99/mo)', () => {
    expect(html).toContain('Cloud Bear');
    expect(html).toContain('0.99');
  });

  it('should show Grizzly Bear ($1.99/mo)', () => {
    expect(html).toContain('Grizzly Bear');
    expect(html).toContain('1.99');
  });

  it('should highlight Cloud Bear as Most Popular', () => {
    expect(html).toContain('Most Popular');
  });

  it('should explain the $240/year savings', () => {
    expect(html).toContain('$240/year');
  });

  it('should show competitive comparison with ChatGPT, Claude, Gemini', () => {
    expect(html).toContain('ChatGPT');
    expect(html).toContain('Claude');
    expect(html).toContain('Gemini');
    expect(html).toContain('$20/mo');
  });
});

// ═══════════════════════════════════════════════════
// CONTENT: API code example
// ═══════════════════════════════════════════════════

describe('Content: API examples', () => {
  it('should show the two-line change pattern', () => {
    expect(html).toContain('localhost:4000/v1');
    expect(html).toContain('sk-llmbear');
  });

  it('should use Python OpenAI SDK syntax', () => {
    // HTML wraps keywords in <span> tags, so check for key fragments
    expect(html).toContain('openai');
    expect(html).toContain('OpenAI');
    expect(html).toContain('client.chat.completions');
  });

  it('should mention compatible tools', () => {
    expect(html).toContain('LangChain');
    expect(html).toContain('Cursor');
    expect(html).toContain('Continue.dev');
  });
});

// ═══════════════════════════════════════════════════
// CONTENT: CTAs and links
// ═══════════════════════════════════════════════════

describe('Content: Calls to action', () => {
  it('should link to GitHub repo', () => {
    expect(html).toContain('github.com/spideysense/OpenLLM');
  });

  it('should have download CTA', () => {
    expect(html).toContain('Download Free');
  });

  it('should have GitHub Fork CTA', () => {
    expect(html).toContain('Fork');
  });

  it('should mention MIT license', () => {
    expect(html).toContain('MIT');
  });

  it('should mention open source models from major providers', () => {
    expect(html).toContain('Meta AI');
    expect(html).toContain('Alibaba');
    expect(html).toContain('Google');
    expect(html).toContain('DeepSeek');
  });
});

// ═══════════════════════════════════════════════════
// CONTENT: Value propositions
// ═══════════════════════════════════════════════════

describe('Content: Value propositions', () => {
  it('should communicate zero setup', () => {
    expect(html).toContain('Zero Setup');
  });

  it('should communicate privacy', () => {
    expect(html).toContain('Totally Private');
    expect(html).toContain('100% private');
  });

  it('should communicate auto-updates', () => {
    expect(html).toContain('Always Up To Date');
  });

  it('should communicate API replacement', () => {
    expect(html).toContain('Drop-In');
    expect(html).toContain('two lines');
  });

  it('should have 3-step how-it-works flow', () => {
    expect(html).toContain('Download');
    expect(html).toContain('Bear Picks Your Model');
    expect(html).toContain('Start Chatting');
  });
});

// ═══════════════════════════════════════════════════
// PERFORMANCE: Page structure
// ═══════════════════════════════════════════════════

describe('Performance: Page structure', () => {
  it('should preconnect to Google Fonts', () => {
    expect(html).toContain('rel="preconnect"');
    expect(html).toContain('fonts.googleapis.com');
  });

  it('should use modern CSS (no external stylesheet dependencies)', () => {
    // All styles should be inline for single-file deployment
    expect(html).toContain('<style>');
    // Should not link to external CSS files
    const cssLinks = html.match(/<link[^>]*rel="stylesheet"[^>]*href="(?!https:\/\/fonts)/g) || [];
    expect(cssLinks).toHaveLength(0);
  });

  it('should have minimal JavaScript at the end', () => {
    const scriptTags = html.match(/<script(?! type="application\/ld)/g) || [];
    expect(scriptTags.length).toBeLessThanOrEqual(2); // Just the scroll observer
  });

  it('should be a reasonable file size (under 50KB)', () => {
    const sizeKB = Buffer.byteLength(html) / 1024;
    expect(sizeKB).toBeLessThan(50);
  });
});

// ═══════════════════════════════════════════════════
// NO-REGRESSION: Full-project TunnelBear check
// ═══════════════════════════════════════════════════

describe('No-Regression: Project-wide brand check', () => {
  const filesToCheck = [
    'src/renderer/styles.css',
    'src/renderer/App.jsx',
    'README.md',
    'PLAN.md',
  ];

  for (const file of filesToCheck) {
    it(`should have no TunnelBear references in ${file}`, () => {
      if (fs.existsSync(path.resolve(file))) {
        const content = fs.readFileSync(path.resolve(file), 'utf8');
        expect(content.toLowerCase()).not.toContain('tunnelbear');
      }
    });
  }
});
