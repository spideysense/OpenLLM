/** Public-site contract for the household product, replacing the retired
 * bear pricing / OpenAI-SDK landing-page contract. */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync('site/index.html', 'utf8');
const page = new DOMParser().parseFromString(html, 'text/html');
const schemas = [...page.querySelectorAll('script[type="application/ld+json"]')].map(s => JSON.parse(s.textContent));
const product = schemas.find(s => s['@type'] === 'SoftwareApplication');
const faq = schemas.find(s => s['@type'] === 'FAQPage');
const config = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
const text = page.body.textContent.replace(/\s+/g, ' ');
const answer = question => faq.mainEntity.find(q => q.name === question)?.acceptedAnswer.text || '';

describe('Aspen household site', () => {
  it('has descriptive and consistent search/social metadata', () => {
    expect(page.title).toMatch(/Aspen.*home/i);
    expect(page.title.length).toBeLessThan(70);
    const description = page.querySelector('meta[name="description"]').content;
    expect(description.length).toBeGreaterThan(100);
    expect(description.length).toBeLessThan(200);
    expect(page.querySelector('link[rel="canonical"]').href).toBe('https://www.runonaspen.com/');
    expect(page.querySelector('meta[property="og:url"]').content).toBe('https://www.runonaspen.com/');
    for (const property of ['og:title', 'og:description', 'og:image', 'og:type']) expect(page.querySelector(`meta[property="${property}"]`).content).toBeTruthy();
    expect(page.querySelector('meta[name="twitter:card"]').content).toBe('summary_large_image');
  });

  it('has one primary heading and accessible document landmarks', () => {
    expect(page.documentElement.lang).toBe('en');
    expect(page.querySelectorAll('h1')).toHaveLength(1);
    expect(page.querySelectorAll('h2').length).toBeGreaterThanOrEqual(3);
    for (const tag of ['header', 'nav', 'main', 'footer']) expect(page.querySelector(tag)).not.toBeNull();
    for (const img of page.images) expect(img.hasAttribute('alt')).toBe(true);
    for (const svg of page.querySelectorAll('svg')) expect(svg.hasAttribute('aria-label') || svg.getAttribute('aria-hidden') === 'true').toBe(true);
    expect(page.querySelector('meta[name="viewport"]').content).toContain('width=device-width');
  });

  it('identifies the actual preview in structured data without selling unfinished hardware', () => {
    expect(product.name).toBe('Aspen');
    expect(product.applicationCategory).toBe('LifestyleApplication');
    expect(product.softwareVersion).toMatch(/preview/i);
    expect(product.offers).toBeUndefined();
    expect(product.downloadUrl).toBeUndefined();
    expect(text).toContain('Hardware in development');
  });

  it('keeps machine-readable FAQs consistent with visible answers', () => {
    expect(faq.mainEntity.length).toBeGreaterThanOrEqual(5);
    const visible = [...page.querySelectorAll('#faq details')];
    expect(visible).toHaveLength(faq.mainEntity.length);
    for (const q of faq.mainEntity) {
      const detail = visible.find(d => d.querySelector('summary').textContent === q.name);
      expect(detail?.querySelector('p').textContent).toBe(q.acceptedAnswer.text);
    }
  });

  it('distinguishes available software from future plug-and-play capabilities', () => {
    expect(answer('What can I use today?')).toMatch(/current Mac, Windows and iPhone downloads.*existing Aspen local AI workspace/);
    expect(answer('Is this the finished plug-and-play product?')).toMatch(/Not yet/);
    expect(answer('Does Aspen use a fine-tuned household model?')).toMatch(/does not include a newly trained or fine-tuned model/);
    expect(answer('What about room speakers and robots?')).toMatch(/Microphone access is disabled/);
  });

  it('describes privacy and discovery limits without claiming universal support', () => {
    expect(answer('Can my family keep things private?')).toMatch(/private by default/);
    expect(answer('Can my family keep things private?')).toMatch(/shared context only/);
    expect(answer('Will Aspen automatically find all my devices?')).toMatch(/Home Assistant/);
    expect(answer('Will Aspen automatically find all my devices?')).toMatch(/not included yet/);
    expect(answer('What works without internet?')).toMatch(/once a compatible model is installed and running/);
  });

  it('provides a working sample CTA and source setup instructions', () => {
    expect(page.querySelector('a[href="/home/?demo=1"]')).not.toBeNull();
    expect(page.querySelector('a[href="/docs#home"]')).not.toBeNull();
    expect(fs.existsSync('site/home/index.html')).toBe(true);
    const docs = new DOMParser().parseFromString(fs.readFileSync('site/docs/index.html', 'utf8'), 'text/html');
    expect(docs.getElementById('home')).not.toBeNull();
    expect(docs.body.textContent).toContain('npm run home');
  });

  it('keeps current Mac and Windows download routes aligned with release artifacts', () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    for (const [route, platform, filename] of [['/download', 'mac', 'Aspen-mac.dmg'], ['/download/win', 'win', 'Aspen-win.exe']]) {
      expect(page.querySelector(`a[href="${route}"]`)).not.toBeNull();
      expect(config.redirects.find(r => r.source === route).destination).toBe('https://github.com/spideysense/OpenLLM/releases/latest/download/' + filename);
      expect(pkg.build[platform].artifactName).toBe('Aspen-' + platform + '.${ext}');
    }
    expect(text).toMatch(/current downloadable app.*existing local AI workspace/);
  });

  it('uses existing local styles/images and valid page anchors', () => {
    for (const element of page.querySelectorAll('img[src], link[rel="stylesheet"], link[rel="icon"]')) {
      const url = element.getAttribute('src') || element.getAttribute('href');
      expect(url.startsWith('/')).toBe(true);
      expect(fs.existsSync(path.join('site', url))).toBe(true);
    }
    for (const link of page.querySelectorAll('a[href^="#"]')) expect(page.getElementById(link.getAttribute('href').slice(1))).not.toBeNull();
    expect(html).not.toContain('fonts.googleapis.com');
    expect(Buffer.byteLength(html)).toBeLessThan(50000);
  });

  it('keeps documentation, privacy and source links available', () => {
    for (const href of ['/docs', '/privacy/', 'https://github.com/spideysense/OpenLLM']) expect(page.querySelector(`a[href="${href}"]`)).not.toBeNull();
    expect(fs.existsSync('site/privacy/index.html')).toBe(true);
  });

  it('keeps a sitemap and allows public search indexing', () => {
    const robots = fs.readFileSync('site/robots.txt', 'utf8');
    expect(robots).toContain('Sitemap: https://www.runonaspen.com/sitemap.xml');
    expect(robots).not.toMatch(/^Disallow:\s*\/$/m);
    const sitemap = fs.readFileSync('site/sitemap.xml', 'utf8');
    expect(sitemap).toContain('<loc>https://www.runonaspen.com/</loc>');
    expect(page.querySelector('meta[name="robots"][content*="noindex"]')).toBeNull();
  });

  it('keeps retired branding out of the product and public source documentation', () => {
    for (const file of ['site/index.html', 'src/renderer/styles.css', 'src/renderer/App.jsx', 'README.md', 'PLAN.md']) {
      if (fs.existsSync(file)) expect(fs.readFileSync(file, 'utf8').toLowerCase()).not.toContain('tunnelbear');
    }
  });
});
