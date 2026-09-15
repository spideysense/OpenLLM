function validate(key, value) {
  const enums = {
    cloudMode: ['off', 'boost', 'auto'],
    modelAutonomy: ['off', 'rankings', 'full'],
    theme: ['light', 'dark', 'system']
  };
  if (enums[key] && !enums[key].includes(value))
    throw new Error(`Invalid ${key}`);
  if (
    [
      'onboarded',
      'computerUseOnboarded',
      'leanMode',
      'autoRetireModels'
    ].includes(key) &&
    typeof value !== 'boolean'
  )
    throw new Error(`Invalid ${key}`);
  if (
    ['activeModel', 'customInstructions', 'pendingPrompt'].includes(key) &&
    value !== null &&
    (typeof value !== 'string' || value.length > 20000)
  )
    throw new Error(`Invalid ${key}`);
  if (
    key === 'activeModel' &&
    value &&
    (!/^[\w./:-]+$/.test(value) || /:cloud/i.test(value))
  )
    throw new Error('Choose a local model');
  if (
    key === 'cloudKeys' &&
    (!value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.entries(value).some(
        ([k, v]) =>
          !/^[A-Z_]+_API_KEY$/.test(k) ||
          typeof v !== 'string' ||
          v.length > 4096
      ))
  )
    throw new Error('Invalid cloud credentials');
  if (
    key === 'worldModel' &&
    (!value ||
      !Array.isArray(value.facts) ||
      value.facts.some((f) => typeof f !== 'string' || f.length > 4000))
  )
    throw new Error('Invalid memory');
  if (key === 'totalExchanges' && (!Number.isSafeInteger(value) || value < 0))
    throw new Error('Invalid count');
  if (
    key === 'dismissedUpgrades' &&
    (!Array.isArray(value) || value.some((v) => typeof v !== 'string'))
  )
    throw new Error('Invalid upgrade list');
}
module.exports = { validate };
