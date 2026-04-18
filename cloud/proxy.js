const db = require('./db');

// Configurable GPU backend — point at Ollama, vLLM, RunPod, Modal, etc.
const GPU_BACKEND = process.env.GPU_BACKEND_URL || 'http://127.0.0.1:11434/v1';
const GPU_API_KEY = process.env.GPU_BACKEND_KEY || '';

// Models available on the cloud cluster
const CLOUD_MODELS = (process.env.CLOUD_MODELS || 'qwen2.5:7b,llama3.2:3b,deepseek-r1:7b,qwen2.5-coder:7b').split(',');

// Model alias resolution (users can send "gpt-4", we route to local model)
const ALIASES = {
  'gpt-4': 'qwen2.5:7b',
  'gpt-4o': 'qwen2.5:7b',
  'gpt-4o-mini': 'llama3.2:3b',
  'gpt-3.5-turbo': 'llama3.2:3b',
  'claude-3.5-sonnet': 'qwen2.5:7b',
  'claude-3-haiku': 'llama3.2:3b',
  'o1': 'deepseek-r1:7b',
  'o1-mini': 'deepseek-r1:7b',
};

function resolveModel(model) {
  return ALIASES[model] || model;
}

/**
 * POST /v1/chat/completions — OpenAI-compatible proxy
 */
async function chatCompletions(req, res) {
  const userId = req.user.id;
  const body = req.body;

  // Resolve model
  const requestedModel = body.model || CLOUD_MODELS[0];
  const resolvedModel = resolveModel(requestedModel);

  // Verify model is available
  if (!CLOUD_MODELS.includes(resolvedModel)) {
    return res.status(400).json({
      error: {
        message: `Model '${requestedModel}' is not available on Cloud Bear. Available: ${CLOUD_MODELS.join(', ')}`,
        type: 'model_error',
        available_models: CLOUD_MODELS,
      }
    });
  }

  // Forward to GPU backend
  const backendBody = { ...body, model: resolvedModel, stream: false };
  const headers = { 'Content-Type': 'application/json' };
  if (GPU_API_KEY) headers['Authorization'] = `Bearer ${GPU_API_KEY}`;

  try {
    const backendRes = await fetch(`${GPU_BACKEND}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(backendBody),
    });

    if (!backendRes.ok) {
      const text = await backendRes.text().catch(() => '');
      return res.status(502).json({
        error: { message: `GPU backend error: ${backendRes.status}`, type: 'backend_error', detail: text }
      });
    }

    const data = await backendRes.json();

    // Track usage
    const tokensIn = data.usage?.prompt_tokens || 0;
    const tokensOut = data.usage?.completion_tokens || 0;
    db.recordUsage(userId, resolvedModel, tokensIn, tokensOut);

    // Return OpenAI-compatible response (swap model name back)
    data.model = requestedModel;
    res.json(data);
  } catch (err) {
    res.status(502).json({
      error: { message: `Cannot reach GPU backend: ${err.message}`, type: 'backend_error' }
    });
  }
}

/**
 * GET /v1/models — list available models
 */
function listModels(req, res) {
  const models = CLOUD_MODELS.map((m) => ({
    id: m,
    object: 'model',
    created: Math.floor(Date.now() / 1000),
    owned_by: 'monet-cloud',
  }));

  // Also list aliases
  for (const [alias, target] of Object.entries(ALIASES)) {
    if (CLOUD_MODELS.includes(target)) {
      models.push({
        id: alias,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'alias → ' + target,
      });
    }
  }

  res.json({ object: 'list', data: models });
}

module.exports = { chatCompletions, listModels, CLOUD_MODELS, ALIASES, resolveModel };
