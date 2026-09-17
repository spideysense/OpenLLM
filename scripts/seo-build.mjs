#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE_DIR = join(ROOT, 'site');
const OLD_ORIGIN = 'https://runonaspen.com';
const CANONICAL_ORIGIN = 'https://www.runonaspen.com';

const HOMEPAGE_TITLE = 'Aspen — The private operating system for your home';
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
  html = html.replace(/<title>[^<]*<\/title>/, '<title>Aspen — The private operating system for your home</title>');
  if (!html.includes('rel="canonical"')) throw new Error('SEO build: missing canonical URL');
  if (!html.includes('SoftwareApplication')) throw new Error('SEO build: missing product schema');
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
