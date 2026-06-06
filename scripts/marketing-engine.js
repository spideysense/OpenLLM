#!/usr/bin/env node
/**
 * Aspen Marketing Engine — runs daily via GitHub Action.
 *
 * Generates:
 * 1. A short-form social post (Twitter/LinkedIn/TikTok caption)
 * 2. An SEO blog post for runonaspen.com/blog
 * 3. A "tip of the day" for the Aspen community
 *
 * Uses Claude API to generate content. Commits blog posts to the repo.
 * Social posts are saved to marketing/queue/ for review or auto-posting.
 *
 * Env vars needed: ANTHROPIC_API_KEY
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const MARKETING_DIR = path.join(__dirname, '..', 'marketing');
const QUEUE_DIR = path.join(MARKETING_DIR, 'queue');
const BLOG_DIR = path.join(__dirname, '..', 'site', 'blog');
const POSTED_FILE = path.join(MARKETING_DIR, 'posted.json');

// Content themes — rotated through
const THEMES = [
  { angle: 'privacy', topics: ['Why your AI conversations should stay on your machine', 'What happens to your data when you use cloud AI', 'The hidden cost of "free" AI — your data', 'Local AI: the privacy revolution nobody is talking about'] },
  { angle: 'cost', topics: ['I saved $500 this year by running AI locally', 'Cloud AI pricing is a trap — here\'s the escape', 'Free AI that actually works — no catch', 'The real cost of ChatGPT Plus vs local AI'] },
  { angle: 'capability', topics: ['My local AI just built me a web app in 30 seconds', 'Watch: local AI with memory that learns who you are', 'I asked my local AI to research a topic — here\'s what happened', 'Local AI can now browse the web, run code, and remember you'] },
  { angle: 'philosophy', topics: ['Your AI should belong to you', 'The case for owning your intelligence', 'Why I stopped using ChatGPT and built my own AI', 'AI independence: why it matters more than you think'] },
  { angle: 'howto', topics: ['How to set up a private AI in 5 minutes', 'Getting started with local AI — no coding required', 'From zero to your own AI: a beginner\'s guide', 'The easiest way to run AI on your own computer'] },
  { angle: 'comparison', topics: ['Local AI vs ChatGPT: honest comparison from someone who uses both', 'What you lose (and gain) by going local with AI', 'Claude vs local models: when does local win?', 'The surprising things local AI does better than cloud'] },
];

function getPosted() {
  try { return JSON.parse(fs.readFileSync(POSTED_FILE, 'utf8')); } catch { return []; }
}

function savePosted(posted) {
  fs.mkdirSync(MARKETING_DIR, { recursive: true });
  fs.writeFileSync(POSTED_FILE, JSON.stringify(posted, null, 2));
}

function pickTopic() {
  const posted = getPosted();
  const allTopics = THEMES.flatMap(t => t.topics.map(topic => ({ angle: t.angle, topic })));
  const unused = allTopics.filter(t => !posted.includes(t.topic));
  if (unused.length === 0) return allTopics[Math.floor(Math.random() * allTopics.length)];
  return unused[Math.floor(Math.random() * unused.length)];
}

async function getActiveModel(tunnelUrl, apiKey) {
  return new Promise((resolve) => {
    const url = new URL('/v1/models', tunnelUrl);
    const req = https.request({
      hostname: url.hostname, port: url.port || 443, path: url.pathname, method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` },
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const models = JSON.parse(data).data || [];
          const local = models.filter(m => m.owned_by !== 'aspen-alias');
          resolve(local[0]?.id || models[0]?.id || 'gemma4');
        } catch { resolve('gemma4'); }
      });
    });
    req.on('error', () => resolve('gemma4'));
    req.setTimeout(10000, () => { req.destroy(); resolve('gemma4'); });
    req.end();
  });
}

async function callClaude(prompt, maxTokens = 2000) {
  const tunnelUrl = process.env.ASPEN_TUNNEL_URL;
  const apiKey = process.env.ASPEN_API_KEY;
  if (!tunnelUrl || !apiKey) throw new Error('ASPEN_TUNNEL_URL and ASPEN_API_KEY must be set');

  const model = await getActiveModel(tunnelUrl, apiKey);
  console.log(`  Using model: ${model}`);

  const url = new URL('/v1/chat/completions', tunnelUrl);

  const body = JSON.stringify({
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
    stream: false,
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const text = json.choices?.[0]?.message?.content || '';
          resolve(text);
        } catch (e) { reject(new Error(`API response parse error: ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('Aspen API timeout (120s)')); });
    req.write(body);
    req.end();
  });
}

async function generateSocialPost(topic, angle) {
  const prompt = `You are the social media manager for Aspen, a free, local-first AI app (runonaspen.com). Aspen runs AI models on the user's own computer — nothing goes to a cloud server. It's free forever, requires no account, and learns about the user over time.

Write a compelling social media post about: "${topic}"

Requirements:
- Write 3 versions: one for Twitter (under 280 chars), one for LinkedIn (2-3 paragraphs), and one TikTok/Instagram caption
- Be authentic, not salesy. Write like a founder who genuinely believes in privacy and local AI
- Include a call to action pointing to runonaspen.com
- Use the angle: ${angle}
- No hashtag spam — max 3 relevant hashtags
- Sound human, not corporate. Conversational tone.

Format your response as:
TWITTER:
[tweet]

LINKEDIN:
[post]

TIKTOK:
[caption]`;

  return callClaude(prompt, 1500);
}

async function generateBlogPost(topic, angle) {
  const prompt = `You are the content writer for Aspen, a free, local-first AI app (runonaspen.com). Write an SEO-optimized blog post about: "${topic}"

Requirements:
- 600-900 words
- Engaging, conversational tone — write like a thoughtful founder, not a content mill
- Include practical examples and real scenarios
- End with a soft CTA to try Aspen (runonaspen.com)
- Output as clean markdown with a title (# heading), subheadings (##), and natural flow
- No "In conclusion" or "In this article we will" — just write naturally
- Include an SEO meta description (one line at the top after the title, italic)

The angle for this piece is: ${angle}`;

  return callClaude(prompt, 3000);
}

async function main() {
  console.log('=== Aspen Marketing Engine ===\n');

  const { topic, angle } = pickTopic();
  console.log(`Topic: "${topic}" (angle: ${angle})\n`);

  // Generate social posts
  console.log('Generating social posts...');
  const social = await generateSocialPost(topic, angle);

  fs.mkdirSync(QUEUE_DIR, { recursive: true });
  const dateStr = new Date().toISOString().split('T')[0];
  const socialFile = path.join(QUEUE_DIR, `${dateStr}-social.md`);
  fs.writeFileSync(socialFile, `# Social Posts — ${dateStr}\nTopic: ${topic}\n\n${social}\n`);
  console.log(`  → Saved to ${socialFile}`);

  // Generate blog post
  console.log('Generating blog post...');
  const blog = await generateBlogPost(topic, angle);

  fs.mkdirSync(BLOG_DIR, { recursive: true });
  const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  const blogFile = path.join(BLOG_DIR, `${dateStr}-${slug}.md`);
  fs.writeFileSync(blogFile, blog);
  console.log(`  → Saved to ${blogFile}`);

  // Mark as posted
  const posted = getPosted();
  posted.push(topic);
  savePosted(posted);

  console.log('\n✅ Marketing content generated. Review in marketing/queue/ and site/blog/.');
}

main().catch(e => {
  console.error('Marketing engine failed:', e.message);
  process.exit(1);
});
