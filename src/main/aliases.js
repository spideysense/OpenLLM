const store = require('./store');

// Default alias map — OpenAI/Anthropic names → local models
// Users can override these in Settings
const DEFAULT_ALIASES = {
  'gpt-4': 'qwen2.5:32b',
  'gpt-4o': 'qwen2.5:7b',
  'gpt-4o-mini': 'qwen2.5:3b',
  'gpt-3.5-turbo': 'llama3.2:3b',
  'claude-3-opus': 'qwen2.5:32b',
  'claude-3.5-sonnet': 'qwen2.5:7b',
  'claude-3-sonnet': 'qwen2.5:7b',
  'claude-3-haiku': 'llama3.2:3b',
  'gemini-pro': 'qwen2.5:7b',
  'gemini-1.5-pro': 'qwen2.5:32b',
  'o1': 'deepseek-r1:14b',
  'o1-mini': 'deepseek-r1:7b',
  'o3-mini': 'deepseek-r1:7b',
};

function getAliases() {
  const custom = store.get('aliases') || {};
  return { ...DEFAULT_ALIASES, ...custom };
}

function getDefaultAliases() {
  return { ...DEFAULT_ALIASES };
}

function setAlias(alias, model) {
  const custom = store.get('aliases') || {};
  custom[alias] = model;
  store.set('aliases', custom);
  return { success: true };
}

function removeAlias(alias) {
  const custom = store.get('aliases') || {};
  delete custom[alias];
  store.set('aliases', custom);
  return { success: true };
}

/**
 * Resolve an alias to the actual Ollama model name.
 * If no alias exists, returns the input unchanged.
 */
function resolve(modelName) {
  const allAliases = getAliases();
  return allAliases[modelName] || modelName;
}

module.exports = { getAliases, getDefaultAliases, setAlias, removeAlias, resolve };
