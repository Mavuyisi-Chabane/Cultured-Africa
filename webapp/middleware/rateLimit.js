// Minimal in-memory sliding-window rate limiter. Deliberately not a new dependency —
// this app is a single Node process with no shared/external store, so an in-memory
// Map is sufficient. Resets on server restart and doesn't share state across
// processes; note this if the app is ever deployed with multiple instances.
function createRateLimiter({ windowMs, max, keyFn }) {
  const hits = new Map();

  return function rateLimiter(req, res, next) {
    const key = keyFn(req);
    const now = Date.now();
    const recent = (hits.get(key) || []).filter(t => now - t < windowMs);

    if (recent.length >= max) {
      req.rateLimitExceeded = true;
      return next();
    }

    recent.push(now);
    hits.set(key, recent);
    next();
  };
}

module.exports = { createRateLimiter };
