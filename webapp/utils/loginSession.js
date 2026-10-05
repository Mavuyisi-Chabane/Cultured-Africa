const { createRateLimiter } = require('../middleware/rateLimit');

// Issues a brand-new session ID at login (then copies in who's logged in), so a session
// ID planted or seen before login is worthless afterwards (session fixation).
// maxAgeMs (optional) replaces the default 4-hour session length, for "Remember me".
function startLoggedInSession(req, values, done, maxAgeMs) {
  // A successful login wipes this account's failed-attempt count.
  perAccount.reset(req);
  req.session.regenerate(err => {
    if (err) return done(err);
    if (maxAgeMs) req.session.cookie.maxAge = maxAgeMs;
    Object.assign(req.session, values);
    req.session.save(done);
  });
}

// Password guessing: at most 10 attempts per account per IP, and 50 per IP across
// all accounts, in any 15 minutes. Routes check req.rateLimitExceeded.
const WINDOW_MS = 15 * 60 * 1000;
const perAccount = createRateLimiter({
  windowMs: WINDOW_MS,
  max: 10,
  keyFn: req => `login:${req.ip}:${String((req.body && req.body.email) || '').trim().toLowerCase()}`
});
const perIp = createRateLimiter({ windowMs: WINDOW_MS, max: 50, keyFn: req => `login-ip:${req.ip}` });

function loginRateLimit(req, res, next) {
  perAccount(req, res, () => perIp(req, res, next));
}

const TOO_MANY_ATTEMPTS = 'Too many login attempts. Please wait 15 minutes and try again, or reset your password.';

const REMEMBER_ME_MS = 30 * 24 * 60 * 60 * 1000;

module.exports = { startLoggedInSession, loginRateLimit, TOO_MANY_ATTEMPTS, REMEMBER_ME_MS };
