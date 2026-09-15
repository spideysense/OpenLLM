/**
 * Tool settings. Computer control requires explicit opt-in. Other built-ins
 * follow user choices; the dispatch policy separately enforces identity and scope.
 */
const store = require('./store');
const { ALL_TOOL_NAMES } = require('./tools');

const KEY = 'disabledTools'; // we store the DISABLED set, so new tools are on by default

function getDisabled() {
  const d = store.get(KEY);
  return [...new Set([...(Array.isArray(d) ? d : []), ...(store.get('computerUseEnabled') === true ? [] : ['computer_use'])])];
}

// Enabled = all known tools minus any the user explicitly disabled.
function getEnabledToolNames() {
  const disabled = getDisabled();
  return ALL_TOOL_NAMES.filter((n) => !disabled.includes(n));
}

function setToolEnabled(name, enabled) {
  if (!ALL_TOOL_NAMES.includes(name)) throw new Error('Unknown tool');
  if (name === 'computer_use') store.set('computerUseEnabled', !!enabled);
  let disabled = getDisabled();
  if (enabled) {
    disabled = disabled.filter((n) => n !== name);
  } else if (!disabled.includes(name)) {
    disabled = [...disabled, name];
  }
  store.set(KEY, disabled);
  return getEnabledToolNames();
}

// For the Settings UI: list every tool with its on/off state.
function getToolStates() {
  const disabled = getDisabled();
  return ALL_TOOL_NAMES.map((name) => ({ name, enabled: !disabled.includes(name) }));
}

module.exports = { getEnabledToolNames, setToolEnabled, getToolStates };
