const crypto = require('crypto');

// Synchronizer-token CSRF protection: every session gets a random token, every form
// posts it back as `_csrf`, and any state-changing request without the matching token
// is refused — so another website can't submit forms on behalf of a logged-in user.
//
// Where the token is read from, in order:
//   body._csrf    — normal forms, and the JSON sent by the video progress tracker
//   x-csrf-token  — header, for any future fetch() calls
//   query._csrf   — only for multipart (file upload) forms, whose body isn't parsed
//                   until multer runs, which is after this check
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function tokensMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function csrfProtection(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;

  if (SAFE_METHODS.has(req.method)) return next();

  const isMultipart = (req.headers['content-type'] || '').startsWith('multipart/form-data');
  const sent = (req.body && req.body._csrf)
    || req.get('x-csrf-token')
    || (isMultipart ? req.query._csrf : undefined);

  if (tokensMatch(sent, req.session.csrfToken)) return next();

  res.status(403);
  return res.render('error', {
    status: 403,
    title: 'This form has expired',
    message: 'For your security, please go back, refresh the page and try again.'
  });
}

module.exports = csrfProtection;
