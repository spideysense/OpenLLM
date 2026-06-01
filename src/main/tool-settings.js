/**
 * Tool settings. Per Aspen's principle, ALL tools are ON by default.
 * The user can disable individual tools in Settings; nothing is forced off.
 */
const store = require('./store');
const { ALL_TOOL_NAMES } = require('./tools');

const KEY = 'disabledTools'; // we store the DISABLED set, so new tools are on by default

function getDisabled() {
  const d = store.get(KEY);
  return Array.isArray(d) ? d : [];
}

// Enabled = all known tools minus any the user explicitly disabled.
function getEnabledToolNames() {
  const disabled = getDisabled();
  return ALL_TOOL_NAMES.filter((n) => !disabled.includes(n));
}

function setToolEnabled(name, enabled) {
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
