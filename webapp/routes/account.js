const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { db, logActivity } = require('../db');
const { requireLogin, redirectAdminAway } = require('../middleware/auth');
const { hashToken } = require('../utils/verification');
const { toSqlDateTime } = require('../utils/dates');
const { sendEmailChangeVerification } = require('../services/email');
const { createRateLimiter } = require('../middleware/rateLimit');

const router = express.Router();

const EMAIL_CHANGE_TTL_MS = 15 * 60 * 1000;
const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Same shape as the other 6-digit codes in this app (utils/verification.js) — a
// separate generator only because email_change_requests is its own table rather
// than reusing email_verification_tokens (this is a logged-in user changing an
// already-verified account, not the initial signup verification).
function generateCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

// 8 attempts per 15 minutes per account — same budget as the registration
// verify-email limiter, guarding the same size of code space.
const verifyEmailChangeLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 8,
  keyFn: req => `${req.ip}:${req.session.user.id}`
});

function renderAccount(req, res, state) {
  const pending = req.session.pendingEmailChange;
  res.render('account', {
    user: req.session.user,
    pendingEmail: pending ? pending.newEmail : null,
    error: null,
    success: null,
    ...state
  });
}

router.get('/account', redirectAdminAway, requireLogin, (req, res) => {
  renderAccount(req, res, {});
});

router.post('/account/email', redirectAdminAway, requireLogin, async (req, res) => {
  const newEmail = (req.body.newEmail || '').trim();
  const password = req.body.password || '';
  const userId = req.session.user.id;
  const user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);

  if (!bcrypt.compareSync(password, user.password_hash)) {
    return renderAccount(req, res, { error: 'Incorrect password.' });
  }
  if (!EMAIL_FORMAT.test(newEmail)) {
    return renderAccount(req, res, { error: 'Please enter a valid email address.' });
  }
  if (newEmail.toLowerCase() === user.email.toLowerCase()) {
    return renderAccount(req, res, { error: 'That is already your current email address.' });
  }
  const taken = db.prepare('SELECT 1 FROM users WHERE lower(email) = lower(?)').get(newEmail)
    || db.prepare('SELECT 1 FROM admins WHERE lower(email) = lower(?)').get(newEmail);
  if (taken) {
    return renderAccount(req, res, { error: 'That email address is already in use.' });
  }

  // A fresh request always supersedes any prior one — only one pending change per
  // account, mirroring how utils/verification.js invalidates old signup codes.
  db.prepare('DELETE FROM email_change_requests WHERE user_id = ?').run(userId);

  const code = generateCode();
  const expiresAt = toSqlDateTime(new Date(Date.now() + EMAIL_CHANGE_TTL_MS));
  db.prepare('INSERT INTO email_change_requests (user_id, new_email, code_hash, expires_at) VALUES (?, ?, ?, ?)')
    .run(userId, newEmail, hashToken(code), expiresAt);

  try {
    await sendEmailChangeVerification({ full_name: user.full_name, email: newEmail }, code);
  } catch (err) {
    console.error('Failed to send email-change verification:', err.message);
  }

  req.session.pendingEmailChange = { newEmail };
  renderAccount(req, res, { pendingEmail: newEmail, success: 'We sent a verification code to your new email address.' });
});

router.post('/account/email/verify', redirectAdminAway, requireLogin, verifyEmailChangeLimiter, (req, res) => {
  const userId = req.session.user.id;
  const code = (req.body.code || '').trim();
  const pending = req.session.pendingEmailChange;

  if (req.rateLimitExceeded) {
    return renderAccount(req, res, { pendingEmail: pending ? pending.newEmail : null, error: 'Too many attempts. Please wait a while before trying again.' });
  }

  const request = db.prepare('SELECT * FROM email_change_requests WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(userId);
  if (!pending || !request) {
    req.session.pendingEmailChange = null;
    return renderAccount(req, res, { error: 'No pending email change found. Please start again.' });
  }
  if (request.expires_at <= toSqlDateTime(new Date())) {
    db.prepare('DELETE FROM email_change_requests WHERE id = ?').run(request.id);
    req.session.pendingEmailChange = null;
    return renderAccount(req, res, { error: 'That code has expired. Please request a new one.' });
  }
  if (hashToken(code) !== request.code_hash) {
    return renderAccount(req, res, { pendingEmail: request.new_email, error: 'Incorrect code.' });
  }

  const user = db.prepare('SELECT full_name FROM users WHERE user_id = ?').get(userId);
  db.prepare('UPDATE users SET email = ? WHERE user_id = ?').run(request.new_email, userId);
  db.prepare('DELETE FROM email_change_requests WHERE id = ?').run(request.id);
  logActivity('Email address changed', user.full_name);

  req.session.user.email = request.new_email;
  req.session.pendingEmailChange = null;
  renderAccount(req, res, { success: 'Your email address has been updated.' });
});

router.post('/account/email/cancel', redirectAdminAway, requireLogin, (req, res) => {
  db.prepare('DELETE FROM email_change_requests WHERE user_id = ?').run(req.session.user.id);
  req.session.pendingEmailChange = null;
  res.redirect('/account');
});

router.post('/account/delete', redirectAdminAway, requireLogin, (req, res) => {
  const password = req.body.password || '';
  const user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(req.session.user.id);

  if (!bcrypt.compareSync(password, user.password_hash)) {
    return renderAccount(req, res, { error: 'Incorrect password. Your account was not deleted.' });
  }

  // Cascades to purchases, feedback, watch_history, watch_progress, notifications,
  // and any pending tokens for this user (all declared ON DELETE CASCADE) — a
  // regular customer's user_id is never referenced by content.uploaded_by, so this
  // never runs into the FK that only matters for admin shadow rows (see db/index.js).
  db.prepare('DELETE FROM users WHERE user_id = ?').run(user.user_id);
  logActivity('Account deleted', user.full_name);

  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
