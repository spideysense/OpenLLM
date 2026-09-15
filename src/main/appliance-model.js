// Provisioning and later boots share the same trusted catalog and qualification.
async function ready() {
  const store = require('./store'), ollama = require('./ollama'), models = require('./models');
  const status = (state, detail = '') => store.set('applianceModelStatus', { state, detail, at: Date.now() });
  try {
    status('starting');
    if (!ollama.getOllamaPath()) throw new Error('Install the reviewed Ollama binary in the factory image before enrollment');
    await ollama.ensureRunning();
    let model = store.get('activeModel');
    if (!model) {
      const system = require('./system');
      const recommended = models.getRecommendation(system.getHardwareTier(), require('../../registry/models.json'), system.getRuntimeBudget());
      if (!recommended) throw new Error('No supported model fits this hardware');
      model = recommended.model;
      const installed = await models.listModels();
      if (!installed.some(m => require('./model-id').normalize(m.name) === require('./model-id').normalize(model))) {
        status('downloading', model);
        const result = await models.pullModel(model);
        if (!result.success) throw new Error(result.error || 'Model download did not finish');
      }
    }
    status('checking', model);
    const result = await require('./model-qualification').qualify(model);
    if (!result.ok) throw new Error(result.error);
    store.set('activeModel', model); status('ready', model); return result;
  } catch (error) { status('needs-attention', error.message); throw error; }
}
module.exports = { ready };
