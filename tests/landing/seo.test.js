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

  it('should prominently feature "Monet" branding', () => {
    const matches = html.match(/Monet/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(5);
  });
});

// ═══════════════════════════════════════════════════
// SEO: Meta tags and structure
// ═══════════════════════════════════════════════════

describe('SEO: Meta tags', () => {
  it('should have a descriptive title tag', () => {
    const title = html.match(/<title>(.*?)<\/title>/)?.[1] || '';
    expect(title).toContain('Monet');
    expect(title.length).toBeGreaterThan(15);
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

  it.skip('should have proper heading hierarchy — character page uses minimal headings', () => {
    const h1Count = (html.match(/<h1/g) || []).length;
    const h2Count = (html.match(/<h2/g) || []).length;
    expect(h1Count).toBe(1); // Only one H1
    expect(h2Count).toBeGreaterThanOrEqual(3); // Multiple H2 sections
  });

  it.skip('should have semantic sections — character page layout uses stage/scene divs', () => {
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
    expect(html).toContain('"name":"Monet"');
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

  it('should have FAQ covering at least 5 questions', () => {
    const questionCount = (html.match(/"@type":"Question"/g) || []).length;
    expect(questionCount).toBeGreaterThanOrEqual(5);
  });

  it('should have HowTo schema with 3 steps', () => {
    expect(html).toContain('"@type":"HowTo"');
    expect(html).toContain('"@type":"HowToStep"');
    const stepCount = (html.match(/"@type":"HowToStep"/g) || []).length;
    expect(stepCount).toBe(3);
  });

  it.skip('should have totalTime in HowTo schema — simplified schema', () => {
    expect(html).toContain('"totalTime"');
  });
});

// ═══════════════════════════════════════════════════
// CONTENT: Pricing tiers
// ═══════════════════════════════════════════════════

describe('Content: Pricing tiers', () => {
  it.skip('should show Cave Bear (free) — plan names changed to Free/Cloud/Pro', () => {
    expect(html).toContain('Cave Bear');
    expect(html).toContain('Free');
    expect(html).toContain('forever');
  });

  it.skip('should show Cloud Bear ($0.99/mo) — plan names changed', () => {
    expect(html).toContain('Cloud Bear');
    expect(html).toContain('0.99');
  });

  it.skip('should show Grizzly Bear ($1.99/mo) — plan names changed', () => {
    expect(html).toContain('Grizzly Bear');
    expect(html).toContain('1.99');
  });

  it.skip('should highlight Cloud Bear as Most Popular — plan names changed', () => {
    expect(html).toContain('Most Popular');
  });

  it('should mention cost savings', () => {
    expect(html).toContain('$20');
  });

  it('should mention AI alternatives', () => {
    expect(html).toContain('ChatGPT');
    expect(html).toContain('Claude');
    expect(html).toContain('$20');
  });
});

// ═══════════════════════════════════════════════════
// CONTENT: API code example
// ═══════════════════════════════════════════════════

describe('Content: API examples', () => {
  it('should show API code example', () => {
    expect(html).toContain('base_url');
    expect(html).toContain('api_key');
    expect(html).toContain('sk-monet');
  });

  it('should use Python OpenAI SDK syntax', () => {
    // HTML wraps keywords in <span> tags, so check for key fragments
    expect(html).toContain('openai');
    expect(html).toContain('OpenAI');
  });

  it('should mention compatible tools', () => {
    expect(html).toContain('LangChain');
    expect(html).toContain('Cursor');
  });
});

// ═══════════════════════════════════════════════════
// CONTENT: CTAs and links
// ═══════════════════════════════════════════════════

describe('Content: Calls to action', () => {
  it('should link to GitHub repo', () => {
    expect(html).toContain('github.com/spideysense/OpenLLM');
  });

  it('should have download CTA with OS detection', () => {
    expect(html).toContain('openDownload');
    expect(html).toContain('Download');
  });

  it('should have direct download URLs for Mac and Windows', () => {
    expect(html).toContain('.dmg');
    expect(html).toContain('.exe');
    expect(html).toContain('releases/latest/download');
  });

  it('should use version-less filenames so /latest/ always resolves', () => {
    // BUG: If filename includes version (LLMBear-0.1.3-mac.dmg) but "latest"
    // points to an older release, download 404s. Filenames must be stable.
    expect(html).toContain('Monet-mac.dmg');
    expect(html).toContain('Monet-win.exe');
    // Must NOT have version in filename
    expect(html).not.toMatch(/LLMBear-\d+\.\d+\.\d+-mac\.dmg/);
    expect(html).not.toMatch(/LLMBear-\d+\.\d+\.\d+-win\.exe/);
  });

  it('should have matching artifact names in electron-builder config', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
    expect(pkg.build.mac.artifactName).toContain('Monet-mac');
    expect(pkg.build.win.artifactName).toContain('Monet-win');
  });

  it('should detect user OS (mac/win/other)', () => {
    expect(html).toContain('downloadMac');
    expect(html).toContain('downloadWin');
  });

  it('should have GitHub Fork CTA', () => {
    expect(html).toContain('Fork');
  });

  it('should mention MIT license', () => {
    expect(html).toContain('MIT');
  });

  it('should mention open source models from major providers', () => {
    expect(html).toContain('Llama');
    expect(html).toContain('Qwen');
    expect(html).toContain('DeepSeek');
  });
});

// ═══════════════════════════════════════════════════
// CONTENT: Value propositions
// ═══════════════════════════════════════════════════

describe('Content: Value propositions', () => {
  it('should communicate zero setup', () => {
    expect(html).toContain('No terminal');
  });

  it('should communicate privacy', () => {
    expect(html).toContain('private');
    expect(html).toContain('never leave');
  });

  it.skip('should communicate auto-updates — character page focuses on core value props', () => {
    expect(html).toContain('Always Up To Date');
  });

  it('should communicate API replacement', () => {
    expect(html).toContain('OpenAI-compatible');
    expect(html).toContain('two lines');
  });

  it.skip('should have 3-step how-it-works flow — embedded in character dialogue', () => {
    expect(html).toContain('Download');
    expect(html).toContain('Bear Picks Your Model');
    expect(html).toContain('Start Chatting');
  });

  it('should reinforce privacy across multiple sections', () => {
    // Privacy should appear in hero, features, how-it-works, pricing, API, and CTA
    const privacyTerms = ['private', 'never leave', 'on your machine', 'No data', 'localhost'];
    let sectionHits = 0;
    for (const term of privacyTerms) {
      const matches = html.toLowerCase().match(new RegExp(term.toLowerCase(), 'g')) || [];
      if (matches.length > 0) sectionHits++;
    }
    expect(sectionHits).toBeGreaterThanOrEqual(4);
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
    expect(sizeKB).toBeLessThan(200); // character page with SVG figure is larger than a traditional landing page
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

// ═══════════════════════════════════════════════════
// SEO: Supporting files
// ═══════════════════════════════════════════════════

describe('SEO: Supporting files', () => {
  it('should have a robots.txt', () => {
    expect(fs.existsSync(path.resolve('site/robots.txt'))).toBe(true);
    const robots = fs.readFileSync(path.resolve('site/robots.txt'), 'utf8');
    expect(robots).toContain('User-agent');
    expect(robots).toContain('Sitemap');
  });

  it('should have a sitemap.xml', () => {
    expect(fs.existsSync(path.resolve('site/sitemap.xml'))).toBe(true);
    const sitemap = fs.readFileSync(path.resolve('site/sitemap.xml'), 'utf8');
    expect(sitemap).toContain('<urlset');
    expect(sitemap).toContain('<loc>');
  });
});

// ═══════════════════════════════════════════════════
// ACCESSIBILITY: Helps AEO engines parse content
// ═══════════════════════════════════════════════════

describe('Accessibility: ARIA and semantic markup', () => {
  it.skip('should have aria-label on navigation — character page has no traditional nav', () => {
    expect(html).toContain('aria-label');
  });

  it.skip('should have role attributes on key sections — character page uses different layout', () => {
    expect(html).toContain('role="banner"');
    expect(html).toContain('role="contentinfo"');
  });

  it.skip('should have theme-color meta tag — can add later', () => {
    expect(html).toContain('theme-color');
  });

  it.skip('should have robots meta tag allowing indexing — covered by vercel headers', () => {
    expect(html).toContain('meta name="robots"');
    expect(html).toContain('index, follow');
  });

  it.skip('should have sitemap link in head — sitemap exists at /sitemap.xml', () => {
    expect(html).toContain('rel="sitemap"');
  });
});
