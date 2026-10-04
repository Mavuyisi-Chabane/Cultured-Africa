// Minimal in-memory sliding-window rate limiter. Deliberately not a new dependency —
// this app is a single Node process with no shared/external store, so an in-memory
// Map is sufficient. Resets on server restart and doesn't share state across
// processes; note this if the app is ever deployed with multiple instances.
function createRateLimiter({ windowMs, max, keyFn }) {
  const hits = new Map();

  // Forget keys whose attempts have all aged out, so the Map can't grow forever.
  const pruneTimer = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, times] of hits) {
      if (!times.some(t => t > cutoff)) hits.delete(key);
    }
  }, windowMs);
  pruneTimer.unref();

  function rateLimiter(req, res, next) {
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
  }

  // Clears the count for this request's key, e.g. after a successful login, so only
  // failed attempts add up towards the limit.
  rateLimiter.reset = req => hits.delete(keyFn(req));
  return rateLimiter;
}

module.exports = { createRateLimiter };
