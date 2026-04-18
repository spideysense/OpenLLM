const db = require('./db');

/**
 * Auth middleware — validates Bearer token (API key) and attaches user info.
 *
 * Sets req.user = { id, email, plan, ... }
 * Sets req.planLimits = { rpm, dailyTokens, cloud, ... }
 */
function authRequired(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: { message: 'Missing API key. Include Authorization: Bearer sk-monet-...',  type: 'auth_error' }
    });
  }

  const token = authHeader.slice(7);
  const keyRow = db.validateApiKey(token);

  if (!keyRow) {
    return res.status(401).json({
      error: { message: 'Invalid API key.', type: 'auth_error' }
    });
  }

  const plan = db.getPlan(keyRow.plan);
  if (!plan.cloud) {
    return res.status(403).json({
      error: {
        message: 'Your plan (Cave Bear) is local-only. Upgrade to Cloud Bear or Grizzly Bear for cloud API access.',
        type: 'plan_error',
        upgrade_url: process.env.LANDING_URL || 'https://open-llm-ten.vercel.app/#pricing',
      }
    });
  }

  req.user = { id: keyRow.uid, email: keyRow.email, plan: keyRow.plan };
  req.planLimits = plan;
  next();
}

module.exports = { authRequired };
