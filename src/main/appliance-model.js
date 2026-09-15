// Provisioning and later boots share the same trusted catalog and qualification.
async function ready({ signal } = {}) {
  const store = require('./store'),
    ollama = require('./ollama'),
    models = require('./models');
  const status = (state, detail = '') =>
    store.set('applianceModelStatus', { state, detail, at: Date.now() });
  try {
    status('starting');
    if (!ollama.getOllamaPath())
      throw new Error('Install the reviewed Ollama binary in the factory image before enrollment');
    await ollama.ensureRunning();
    signal?.throwIfAborted();
    let model = store.get('activeModel');
    if (!model) {
      const system = require('./system');
      const selector = require('./model-selection');
      const shortlist = selector.candidates(
        system.getHardwareTier(),
        require('../../registry/models.json'),
        system.getRuntimeBudget(),
        system.getSystemInfo().gpu.type !== 'cpu'
      );
      if (!shortlist.length) throw new Error('No supported model fits this hardware');
      const installed = await models.listModels();
      const results = [];
      for (const candidate of shortlist) {
        model = candidate.model;
        try {
          signal?.throwIfAborted();
          if (!installed.some(m => require('./model-id').normalize(m.name) === require('./model-id').normalize(model))) {
            status('downloading', model);
            const result = await models.pullModel(model, progress => status('downloading', `${model}: ${progress.percent || 0}%`), { signal, allowRetry: false });
            if (!result.success) throw new Error(result.error || 'Model download did not finish');
          }
          status('checking', model);
          const qualification = await require('./model-qualification').qualify(model, { signal });
          if (!qualification.ok || !qualification.tools) throw new Error(qualification.error || 'Model needs reliable tool support');
          status('measuring', model);
          const benchmark = await require('./model-benchmark').evaluate(model, { context: system.getRecommendedContext(), signal });
          results.push({ model, qualification, benchmark });
          store.set('applianceModelComparison', results);
        } catch (error) {
          signal?.throwIfAborted();
          results.push({ model, error: error.message });
          store.set('applianceModelComparison', results);
        }
      }
      const chosen = selector.choose(results);
      if (!chosen) throw new Error('No model passed the local quality checks. Check network access and retry setup.');
      model = chosen.model;
    }
    status('checking', model);
    signal?.throwIfAborted();
    const result = await require('./model-qualification').qualify(model, { signal });
    if (!result.ok || !result.tools) throw new Error(result.error || 'Model needs reliable tool support');
    store.set('activeModel', model);
    status('ready', model);
    return result;
  } catch (error) {
    status('needs-attention', error.message);
    throw error;
  }
}
module.exports = { ready };
