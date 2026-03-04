const db = require('./db');

// In-memory sliding window for RPM tracking
const windows = new Map(); // userId -> [timestamps]

function rateLimit(req, res, next) {
  const userId = req.user.id;
  const limits = req.planLimits;

  // ── Check RPM ──
  const now = Date.now();
  const windowMs = 60_000;
  if (!windows.has(userId)) windows.set(userId, []);
  const userWindow = windows.get(userId);

  // Evict old entries
  while (userWindow.length > 0 && userWindow[0] < now - windowMs) {
    userWindow.shift();
  }

  if (userWindow.length >= limits.rpm) {
    const retryAfter = Math.ceil((userWindow[0] + windowMs - now) / 1000);
    return res.status(429).json({
      error: {
        message: `Rate limit exceeded. Your plan (${limits.name}) allows ${limits.rpm} requests/minute. Try again in ${retryAfter}s.`,
        type: 'rate_limit_error',
        retry_after: retryAfter,
      }
    });
  }

  // ── Check daily token budget ──
  const dailyUsage = db.getDailyUsage(userId);
  if (dailyUsage >= limits.dailyTokens) {
    return res.status(429).json({
      error: {
        message: `Daily token limit reached. Your plan (${limits.name}) allows ${limits.dailyTokens.toLocaleString()} tokens/day. Resets at midnight UTC.`,
        type: 'token_limit_error',
        usage: dailyUsage,
        limit: limits.dailyTokens,
      }
    });
  }

  // Record this request in the RPM window
  userWindow.push(now);
  next();
}

// Cleanup old windows periodically
setInterval(() => {
  const cutoff = Date.now() - 120_000;
  for (const [userId, timestamps] of windows) {
    if (timestamps.length === 0 || timestamps[timestamps.length - 1] < cutoff) {
      windows.delete(userId);
    }
  }
}, 60_000);

module.exports = { rateLimit };
