const OWNER_ONLY = new Set([
  'run_command',
  'download_file',
  'publish_app',
  'start_mission',
  'mission_status',
  'stop_mission'
]);
function ownerOnly(name) {
  return (
    OWNER_ONLY.has(name) ||
    name.startsWith('git_') ||
    name.startsWith('computer_') ||
    name.includes('__')
  );
}
function allowed(
  name,
  { isOwner = false, offered = null, allowComputerUse = false } = {}
) {
  if (typeof name !== 'string' || !name) return false;
  if (require('./execution-context').privateContext() && !['vault_search', 'calculate', 'get_datetime'].includes(name)) return false;
  if (ownerOnly(name) && !isOwner) return false;
  if (name.startsWith('computer_') && !allowComputerUse) return false;
  if (offered && !offered.has(name)) return false;
  const enabled = require('./tool-settings').getEnabledToolNames();
  if (name.includes('__')) return isOwner;
  return enabled.includes(name.startsWith('computer_') ? 'computer_use' : name);
}
function filter(defs, opts) {
  return defs.filter((d) => allowed(d.function?.name, opts));
}
module.exports = { allowed, filter, ownerOnly };
