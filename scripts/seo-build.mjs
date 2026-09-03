#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE_DIR = join(ROOT, 'site');
const OLD_ORIGIN = 'https://runonaspen.com';
const CANONICAL_ORIGIN = 'https://www.runonaspen.com';

const HOMEPAGE_TITLE = 'Aspen — Free Local AI for Mac, Windows & iPhone';
const HOMEPAGE_DESCRIPTION = 'Aspen is a free local AI app for Mac, Windows and iPhone. Run private LLMs on your own hardware, work offline, and use an OpenAI-compatible API.';
const SOCIAL_TITLE = 'Aspen — Free, Private Local AI on Your Own Hardware';
const SOCIAL_DESCRIPTION = 'Run local LLMs privately on Mac, Windows and iPhone. Free app, no account, offline core use, with an OpenAI-compatible API.';

export function canonicalizeOrigins(text) {
  return text.replaceAll(OLD_ORIGIN, CANONICAL_ORIGIN);
}

function replaceRequired(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`SEO build: missing ${label}`);
  return text.replace(from, to);
}

export function optimizeHomepage(source) {
  let html = canonicalizeOrigins(source);

  html = replaceRequired(
    html,
    '<title>Aspen: Own your intelligence</title>',
    `<title>${HOMEPAGE_TITLE}</title>`,
    'homepage title',
  );

  html = replaceRequired(
    html,
    '<meta name="description" content="Aspen is private AI that runs on your hardware. No subscriptions. No cloud. Free desktop app for Mac and Windows, free iPhone app, or preorder the dedicated Aspen device.">',
    `<meta name="description" content="${HOMEPAGE_DESCRIPTION}">`,
    'homepage description',
  );

  html = replaceRequired(
    html,
    '<meta property="og:title" content="Aspen: Own your intelligence">',
    `<meta property="og:title" content="${SOCIAL_TITLE}">`,
    'Open Graph title',
  );

  html = replaceRequired(
    html,
    '<meta property="og:description" content="Private AI on your hardware. No subscriptions. No cloud.">',
    `<meta property="og:description" content="${SOCIAL_DESCRIPTION}">`,
    'Open Graph description',
  );

  html = replaceRequired(
    html,
    '<meta name="twitter:title" content="Aspen: Own your intelligence">',
    `<meta name="twitter:title" content="${SOCIAL_TITLE}">`,
    'Twitter title',
  );

  html = replaceRequired(
    html,
    '<meta name="twitter:description" content="Private AI on your hardware. No subscriptions. No cloud.">',
    `<meta name="twitter:description" content="${SOCIAL_DESCRIPTION}">`,
    'Twitter description',
  );

  const softwareSchemaPattern = /<script type="application\/ld\+json">\{"@context":"https:\/\/schema\.org","@type":"SoftwareApplication","name":"Aspen"[^\n]*?<\/script>/;
  if (!softwareSchemaPattern.test(html)) throw new Error('SEO build: missing SoftwareApplication schema');

  const softwareSchema = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Aspen',
    url: `${CANONICAL_ORIGIN}/`,
    description: HOMEPAGE_DESCRIPTION,
    applicationCategory: 'ProductivityApplication',
    operatingSystem: 'macOS, Windows, iOS',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    downloadUrl: 'https://github.com/spideysense/OpenLLM/releases/latest/download/Aspen-mac.dmg',
    sameAs: [
      'https://apps.apple.com/app/id6775307566',
      'https://github.com/spideysense/OpenLLM',
    ],
    featureList: [
      'Runs local large language models on your own hardware',
      'Works offline for core chat and coding after model download',
      'OpenAI-compatible local API',
      'Private on-device conversations and files',
    ],
    author: { '@type': 'Organization', name: 'Aspen', url: `${CANONICAL_ORIGIN}/` },
  };

  html = html.replace(
    softwareSchemaPattern,
    `<script type="application/ld+json">${JSON.stringify(softwareSchema)}</script>`,
  );

  return html;
}

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

export function runSeoBuild(siteDir = SITE_DIR) {
  const indexPath = join(siteDir, 'index.html');
  writeFileSync(indexPath, optimizeHomepage(readFileSync(indexPath, 'utf8')));

  for (const path of walk(siteDir)) {
    if (path === indexPath || !/\.(?:html|xml|txt)$/.test(path)) continue;
    const before = readFileSync(path, 'utf8');
    const after = canonicalizeOrigins(before);
    if (after !== before) writeFileSync(path, after);
  }

  console.log(`✓ SEO build: canonicalized site to ${CANONICAL_ORIGIN}`);
  console.log(`  homepage title: ${HOMEPAGE_TITLE}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSeoBuild();
}
