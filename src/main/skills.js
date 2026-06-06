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

  if (/\b(git|clone|commit|push|repo|deploy)\b/.test(msg)) {
    const content = readSkill('git-workflow');
    if (content) relevant.push(content);
  }

  if (/\b(html|web ?app|website|landing|page|game|quiz|artifact)\b/.test(msg)) {
    const content = readSkill('html-artifact');
    if (content) relevant.push(content);
  }

  if (/\b(screenshot|recreate|rebuild|copy this|make this|looks like|photo of|image of)\b/.test(msg)) {
    const content = readSkill('screenshot-to-app');
    if (content) relevant.push(content);
  }

  return relevant;
}

module.exports = {
  listSkills,
  readSkill,
  getSkillsSummary,
  getRelevantSkills,
};
