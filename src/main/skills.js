/**
 * Skills — structured instructions the model reads before performing tasks.
 *
 * Built-in skills ship with Aspen in the skills/ directory.
 * Users can add custom skills to ~/.aspen/skills/ (created on first launch).
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Built-in skills (bundled with the app)
const builtinDir = path.join(__dirname, '..', '..', 'skills');
// User skills (persisted in app data)
const userDir = path.join(app.getPath('userData'), 'skills');

function ensureUserDir() {
  try { fs.mkdirSync(userDir, { recursive: true }); } catch {}
}

/**
 * List all available skills (built-in + user).
 * Returns [{ name, path, source }]
 */
function listSkills() {
  const skills = [];

  // Built-in
  try {
    for (const f of fs.readdirSync(builtinDir)) {
      if (f.endsWith('.md')) {
        skills.push({
          name: f.replace('.md', ''),
          path: path.join(builtinDir, f),
          source: 'builtin',
        });
      }
    }
  } catch {}

  // User
  ensureUserDir();
  try {
    for (const f of fs.readdirSync(userDir)) {
      if (f.endsWith('.md')) {
        skills.push({
          name: f.replace('.md', ''),
          path: path.join(userDir, f),
          source: 'user',
        });
      }
    }
  } catch {}

  return skills;
}

/**
 * Read a skill's content by name.
 */
function readSkill(name) {
  const skills = listSkills();
  const skill = skills.find(s => s.name === name);
  if (!skill) return null;
  try { return fs.readFileSync(skill.path, 'utf8'); } catch { return null; }
}

/**
 * Generate a skills summary for the agent directive.
 * Lists available skills so the model knows what guidance exists.
 */
function getSkillsSummary() {
  const skills = listSkills();
  if (skills.length === 0) return '';

  const lines = skills.map(s => `  - ${s.name} (${s.source})`);
  return `\nYou have access to the following skills (best-practice guides). Read a skill before starting a task by calling run_command with: cat ${builtinDir}/SKILLNAME.md\n\nAvailable skills:\n${lines.join('\n')}\n`;
}

/**
 * Auto-detect which skills are relevant for a user message.
 * Returns the content of matching skills.
 */
function getRelevantSkills(userMessage) {
  const msg = (userMessage || '').toLowerCase();
  const relevant = [];

  const match = (pattern, skillName) => {
    if (pattern.test(msg)) {
      const content = readSkill(skillName);
      if (content) relevant.push(content);
    }
  };

  // Development
  match(/(git|clone|commit|push|repo|deploy|token|pat_|ghp_)/, 'git-workflow');
  match(/\b(chrome extension|browser extension|manifest\.json|content script|service worker|mv3|manifest v3|popup\.html|browser plugin)\b/, 'chrome-extension');
  match(/(html|web ?app|website|landing|page|game|quiz|artifact|calculator|tool|widget)/, 'html-artifact');
  match(/(screenshot|recreate|rebuild|copy this|make this|looks like|photo of|image of)/, 'screenshot-to-app');
  match(/(design|beautiful|polished|professional|ui|ux|style|css|layout|responsive|dark mode|theme|color|font|typography|mockup|wireframe)/, 'frontend-design');
  match(/(full.?stack|next\.?js|react|api|database|auth|login|signup|saas|vercel|supabase|stripe|payment|backend)/, 'full-stack-app');
  match(/(chart|graph|visuali|dashboard|data viz|kpi|metric|plot|bar chart|line chart|donut)/, 'data-visualization');
  match(/(test|debug|refactor|review|code quality|best practice|architecture|clean code|lint|security|performance)/, 'code-quality');

  // Product & Operations
  match(/(prd|product.*req|roadmap|prioriti|user stor|backlog|feature.*request|go.to.market|competitive|persona|jobs.to.be.done)/, 'product-management');
  match(/(sprint|ticket|estimate|standup|retro|backlog|agile|scrum|kanban|jira|linear|epic)/, 'sprint-planning');
  match(/(ci.?cd|pipeline|deploy|monitor|incident|devops|docker|infrastructure|kubernetes|terraform|staging|production|rollback)/, 'engineering-ops');
  match(/(analytics|tracking|funnel|cohort|retention|churn|dau|mau|conversion|a.b test|experiment|north star)/, 'analytics');

  // Design & UX
  match(/(ux|user research|usability|accessibility|a11y|wireframe|prototype|persona|user journey|information architecture|heuristic)/, 'ux-design');

  // Documents & Content
  match(/(document|report|memo|letter|invoice|resume|cv|cover letter|pdf|word|docx|spreadsheet|xlsx|slide|presentation|pptx|deck)/, 'documents');
  match(/(ad |marketing|creative|campaign|landing page|email.*market|social media|seo|copy|headline|cta|brand)/, 'marketing-creative');
  match(/(write|email|blog|article|essay|post|draft|tone|newsletter|copy)/, 'writing');

  // Limit to top 3 most relevant skills to avoid context overload
  return relevant.slice(0, 3);
}

module.exports = {
  listSkills,
  readSkill,
  getSkillsSummary,
  getRelevantSkills,
};
