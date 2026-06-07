#!/usr/bin/env node
/**
 * Build blog — converts markdown posts to SEO-optimized HTML pages.
 * 
 * Generates:
 * - Individual HTML pages at /blog/[slug].html with full meta tags
 * - Blog index page at /blog/index.html
 * - Sitemap entries appended to /sitemap.xml
 * - RSS feed at /blog/feed.xml
 *
 * Run: node scripts/build-blog.js
 * Called automatically by Vercel build or GitHub Action.
 */

const fs = require('fs');
const path = require('path');

const BLOG_MD_DIR = path.join(__dirname, '..', 'site', 'blog');
const BLOG_OUT_DIR = path.join(__dirname, '..', 'site', 'blog');
const SITE_DIR = path.join(__dirname, '..', 'site');
const BASE_URL = 'https://runonaspen.com';

function slugFromFilename(f) {
  // 2026-06-06-some-title.md → some-title
  return f.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '');
}

function dateFromFilename(f) {
  const m = f.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : new Date().toISOString().split('T')[0];
}

function extractMeta(md) {
  const lines = md.split('\n');
  let title = 'Aspen Blog';
  let description = '';
  
  // First # heading is the title
  for (const line of lines) {
    if (line.startsWith('# ')) { title = line.slice(2).trim(); break; }
  }
  
  // First italic line or first paragraph is the description
  for (const line of lines) {
    if (line.startsWith('*') && line.endsWith('*') && !line.startsWith('**')) {
      description = line.replace(/^\*|\*$/g, '').trim();
      break;
    }
  }
  if (!description) {
    const firstPara = lines.find(l => l.trim() && !l.startsWith('#') && !l.startsWith('*'));
    description = (firstPara || '').slice(0, 160);
  }
  
  return { title, description };
}

function markdownToHtml(md) {
  let html = md
    // Headers
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold and italic
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    // Code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Lists
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // Paragraphs (double newline)
    .replace(/\n\n+/g, '\n</p>\n<p>\n');
  
  // Wrap in paragraphs
  html = '<p>\n' + html + '\n</p>';
  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, '');
  // Wrap lists
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
  
  return html;
}

function generatePostHtml(md, meta, date, slug) {
  const content = markdownToHtml(md);
  const url = `${BASE_URL}/blog/${slug}.html`;
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${meta.title} — Aspen</title>
<meta name="description" content="${meta.description}">
<meta name="author" content="Mayank Mehta">
<link rel="canonical" href="${url}">

<!-- Open Graph -->
<meta property="og:title" content="${meta.title}">
<meta property="og:description" content="${meta.description}">
<meta property="og:url" content="${url}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Aspen — Own your intelligence">
<meta property="article:published_time" content="${date}T00:00:00Z">
<meta property="article:author" content="Mayank Mehta">

<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${meta.title}">
<meta name="twitter:description" content="${meta.description}">

<!-- Schema.org -->
<script type="application/ld+json">
${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  "headline": meta.title,
  "description": meta.description,
  "datePublished": `${date}T00:00:00Z`,
  "author": { "@type": "Person", "name": "Mayank Mehta" },
  "publisher": { "@type": "Organization", "name": "Aspen", "url": BASE_URL },
  "mainEntityOfPage": url,
}, null, 2)}
</script>

<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Georgia', serif; background: #faf8f5; color: #2c2c2c; line-height: 1.8; }
  .nav { padding: 1rem 2rem; border-bottom: 1px solid #eee; display: flex; align-items: center; gap: 1rem; }
  .nav a { color: #b8860b; text-decoration: none; font-weight: 600; }
  article { max-width: 680px; margin: 3rem auto; padding: 0 1.5rem; }
  h1 { font-size: 2.2rem; line-height: 1.3; margin-bottom: .5rem; color: #1a1a1a; }
  .meta { color: #888; font-size: .9rem; margin-bottom: 2rem; }
  h2 { font-size: 1.4rem; margin: 2rem 0 .8rem; color: #1a1a1a; }
  h3 { font-size: 1.15rem; margin: 1.5rem 0 .6rem; }
  p { margin-bottom: 1.2rem; }
  a { color: #b8860b; }
  code { font-family: monospace; background: rgba(0,0,0,.05); padding: 2px 5px; border-radius: 3px; font-size: .9em; }
  pre { background: #1a1a1a; color: #d4d4d4; padding: 1rem; border-radius: 8px; overflow-x: auto; margin: 1rem 0; }
  pre code { background: none; padding: 0; color: inherit; }
  ul { margin: 1rem 0; padding-left: 1.5rem; }
  li { margin-bottom: .4rem; }
  .cta { margin: 3rem 0; padding: 2rem; background: rgba(184,134,11,.06); border: 1.5px solid rgba(184,134,11,.15); border-radius: 12px; text-align: center; }
  .cta a { display: inline-block; padding: .7rem 1.5rem; background: #b8860b; color: #fff; border-radius: 8px; text-decoration: none; font-weight: 600; }
  footer { text-align: center; padding: 2rem; color: #999; font-size: .8rem; }
</style>
</head>
<body>
<nav class="nav">
  <a href="/">🌿 Aspen</a>
  <a href="/blog/">Blog</a>
</nav>
<article>
  <h1>${meta.title}</h1>
  <div class="meta">By Mayank Mehta · ${new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
  ${content}
  <div class="cta">
    <p style="margin-bottom:1rem;font-weight:600">Ready to own your AI?</p>
    <a href="${BASE_URL}">Try Aspen free →</a>
  </div>
</article>
<footer>© ${new Date().getFullYear()} Aspen · <a href="/">Home</a> · <a href="/blog/">Blog</a> · <a href="/#contact">Contact</a></footer>
</body>
</html>`;
}

function generateIndex(posts) {
  const postCards = posts.map(p => `
    <a href="/blog/${p.slug}.html" class="post-card">
      <div class="post-date">${new Date(p.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</div>
      <h2 class="post-title">${p.title}</h2>
      <p class="post-desc">${p.description}</p>
    </a>`).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Blog — Aspen</title>
<meta name="description" content="Thoughts on local AI, privacy, and owning your intelligence. From the makers of Aspen.">
<link rel="canonical" href="${BASE_URL}/blog/">
<link rel="alternate" type="application/rss+xml" title="Aspen Blog" href="${BASE_URL}/blog/feed.xml">
<meta property="og:title" content="Aspen Blog">
<meta property="og:description" content="Thoughts on local AI, privacy, and owning your intelligence.">
<meta property="og:url" content="${BASE_URL}/blog/">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Georgia', serif; background: #faf8f5; color: #2c2c2c; }
  .nav { padding: 1rem 2rem; border-bottom: 1px solid #eee; display: flex; align-items: center; gap: 1rem; }
  .nav a { color: #b8860b; text-decoration: none; font-weight: 600; }
  .hero { text-align: center; padding: 3rem 1.5rem 2rem; }
  .hero h1 { font-size: 2rem; margin-bottom: .5rem; }
  .hero p { color: #666; }
  .posts { max-width: 680px; margin: 0 auto; padding: 0 1.5rem 3rem; }
  .post-card { display: block; padding: 1.5rem; margin-bottom: 1rem; border: 1.5px solid #eee; border-radius: 12px; text-decoration: none; color: inherit; transition: all .15s; }
  .post-card:hover { border-color: #b8860b; transform: translateY(-1px); }
  .post-date { font-size: .8rem; color: #999; margin-bottom: .3rem; }
  .post-title { font-size: 1.2rem; margin-bottom: .4rem; color: #1a1a1a; }
  .post-desc { font-size: .9rem; color: #666; line-height: 1.5; }
  footer { text-align: center; padding: 2rem; color: #999; font-size: .8rem; }
</style>
</head>
<body>
<nav class="nav"><a href="/">🌿 Aspen</a> <a href="/blog/">Blog</a></nav>
<div class="hero">
  <h1>Aspen Blog</h1>
  <p>Thoughts on local AI, privacy, and owning your intelligence.</p>
</div>
<div class="posts">
${postCards}
</div>
<footer>© ${new Date().getFullYear()} Aspen · <a href="/">Home</a> · <a href="/#contact">Contact</a> · <a href="/blog/feed.xml">RSS</a></footer>
</body>
</html>`;
}

function generateRSS(posts) {
  const items = posts.slice(0, 20).map(p => `
  <item>
    <title><![CDATA[${p.title}]]></title>
    <link>${BASE_URL}/blog/${p.slug}.html</link>
    <description><![CDATA[${p.description}]]></description>
    <pubDate>${new Date(p.date).toUTCString()}</pubDate>
    <guid>${BASE_URL}/blog/${p.slug}.html</guid>
  </item>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>Aspen Blog</title>
  <link>${BASE_URL}/blog/</link>
  <description>Thoughts on local AI, privacy, and owning your intelligence.</description>
  <atom:link href="${BASE_URL}/blog/feed.xml" rel="self" type="application/rss+xml"/>
  ${items}
</channel>
</rss>`;
}

function main() {
  console.log('=== Building Blog ===\n');

  const files = fs.readdirSync(BLOG_MD_DIR).filter(f => f.endsWith('.md')).sort().reverse();
  if (files.length === 0) { console.log('No posts found.'); return; }

  const posts = [];

  for (const file of files) {
    const md = fs.readFileSync(path.join(BLOG_MD_DIR, file), 'utf8');
    const slug = slugFromFilename(file);
    const date = dateFromFilename(file);
    const meta = extractMeta(md);
    
    // Generate HTML page
    const html = generatePostHtml(md, meta, date, slug);
    const outPath = path.join(BLOG_OUT_DIR, `${slug}.html`);
    fs.writeFileSync(outPath, html);
    console.log(`  ✅ ${slug}.html (${meta.title})`);

    posts.push({ slug, date, ...meta });
  }

  // Generate index
  fs.writeFileSync(path.join(BLOG_OUT_DIR, 'index.html'), generateIndex(posts));
  console.log(`  ✅ index.html (${posts.length} posts)`);

  // Generate RSS
  fs.writeFileSync(path.join(BLOG_OUT_DIR, 'feed.xml'), generateRSS(posts));
  console.log('  ✅ feed.xml');

  // Append to sitemap
  const sitemapPath = path.join(SITE_DIR, 'sitemap.xml');
  if (fs.existsSync(sitemapPath)) {
    let sitemap = fs.readFileSync(sitemapPath, 'utf8');
    for (const p of posts) {
      const url = `${BASE_URL}/blog/${p.slug}.html`;
      if (!sitemap.includes(url)) {
        sitemap = sitemap.replace('</urlset>', `  <url><loc>${url}</loc><lastmod>${p.date}</lastmod><changefreq>monthly</changefreq></url>\n</urlset>`);
      }
    }
    // Add blog index
    if (!sitemap.includes('/blog/')) {
      sitemap = sitemap.replace('</urlset>', `  <url><loc>${BASE_URL}/blog/</loc><changefreq>daily</changefreq><priority>0.8</priority></url>\n</urlset>`);
    }
    fs.writeFileSync(sitemapPath, sitemap);
    console.log('  ✅ sitemap.xml updated');
  }

  console.log(`\n✅ Blog built — ${posts.length} posts`);
}

main();
