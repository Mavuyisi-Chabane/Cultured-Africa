const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { db, logActivity, customerActor, notify } = require('../db');
const { requireLogin, redirectAdminAway } = require('../middleware/auth');
const { hashToken } = require('../utils/verification');
const { toSqlDateTime } = require('../utils/dates');
const { sendEmailChangeVerification, sendPasswordChangedEmail } = require('../services/email');
const { getPasswordRequirementFailures } = require('../utils/password');
const { createRateLimiter } = require('../middleware/rateLimit');
const { getReceipt, listPurchases } = require('../utils/receipts');

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

// The customer's newsletter subscription, matched on their account email (the same list
// the landing-page sign-up feeds). Returns { subscribed, since } .
function getNewsletterStatus(email) {
  const row = db.prepare('SELECT status, confirmed_at FROM newsletter_subscribers WHERE email = ?').get(String(email).toLowerCase());
  const subscribed = Boolean(row && row.status === 'confirmed');
  return { subscribed, since: subscribed && row.confirmed_at ? new Date(row.confirmed_at.replace(' ', 'T') + 'Z') : null };
}

function renderAccount(req, res, state) {
  const pending = req.session.pendingEmailChange;
  const consent = db.prepare('SELECT privacy_consent_at, adult_confirmed_at FROM users WHERE user_id = ?').get(req.session.user.id);
  res.render('account', {
    user: req.session.user,
    consentAt: consent && consent.privacy_consent_at ? new Date(consent.privacy_consent_at.replace(' ', 'T') + 'Z') : null,
    adultConfirmedAt: consent && consent.adult_confirmed_at ? new Date(consent.adult_confirmed_at.replace(' ', 'T') + 'Z') : null,
    purchases: listPurchases(req.session.user.id),
    newsletter: getNewsletterStatus(req.session.user.email),
    pendingEmail: pending ? pending.newEmail : null,
    error: null,
    success: null,
    ...state
  });
}

router.get('/account', redirectAdminAway, requireLogin, (req, res) => {
  renderAccount(req, res, {});
});

// Proof of purchase for one of the logged-in customer's own purchases.
router.get('/account/purchases/:id/receipt', redirectAdminAway, requireLogin, (req, res) => {
  const receipt = getReceipt(Number(req.params.id), req.session.user.id);
  if (!receipt) {
    return res.status(404).render('error', { status: 404, title: 'Receipt not found', message: "We couldn't find that receipt in your account." });
  }
  res.render('receipt', { receipt });
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

  const user = db.prepare('SELECT full_name, email FROM users WHERE user_id = ?').get(userId);
  db.prepare('UPDATE users SET email = ? WHERE user_id = ?').run(request.new_email, userId);
  // Keep any newsletter subscription with the account's new address.
  const subscription = db.prepare('SELECT id FROM newsletter_subscribers WHERE email = ?').get(String(user.email).toLowerCase());
  if (subscription) {
    db.prepare('DELETE FROM newsletter_subscribers WHERE email = ? AND id != ?').run(String(request.new_email).toLowerCase(), subscription.id);
    db.prepare('UPDATE newsletter_subscribers SET email = ? WHERE id = ?').run(String(request.new_email).toLowerCase(), subscription.id);
  }
  db.prepare('DELETE FROM email_change_requests WHERE id = ?').run(request.id);
  logActivity('Email address changed', user.full_name, customerActor(user.full_name));

  req.session.user.email = request.new_email;
  req.session.pendingEmailChange = null;
  renderAccount(req, res, { success: 'Your email address has been updated.' });
});

router.post('/account/email/cancel', redirectAdminAway, requireLogin, (req, res) => {
  db.prepare('DELETE FROM email_change_requests WHERE user_id = ?').run(req.session.user.id);
  req.session.pendingEmailChange = null;
  res.redirect('/account');
});

// Display name: 2–80 characters, at least one letter, no angle brackets.
function validateName(name) {
  if (name.length < 2 || name.length > 80) return 'Your name must be between 2 and 80 characters.';
  if (!/\p{L}/u.test(name)) return 'Your name must contain letters.';
  if (/[<>]/.test(name)) return 'Your name cannot contain < or >.';
  return null;
}

router.post('/account/name', redirectAdminAway, requireLogin, (req, res) => {
  const fullName = String(req.body.fullName || '').trim().replace(/\s+/g, ' ');
  const error = validateName(fullName);
  if (error) return renderAccount(req, res, { error, nameValue: fullName });
  if (fullName === req.session.user.fullName) return renderAccount(req, res, { success: 'Your name is unchanged.' });

  db.prepare('UPDATE users SET full_name = ? WHERE user_id = ?').run(fullName, req.session.user.id);
  logActivity('Name changed', fullName, customerActor(fullName));
  req.session.user.fullName = fullName;
  renderAccount(req, res, { success: 'Your name has been updated.' });
});

// 8 wrong current-password attempts per 15 minutes per account, so a session left open
// on a shared computer can't be used to guess the password.
const changePasswordLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 8,
  keyFn: req => `change-password:${req.ip}:${req.session.user.id}`
});

router.post('/account/password', redirectAdminAway, requireLogin, changePasswordLimiter, async (req, res) => {
  const { currentPassword = '', newPassword = '', confirmPassword = '' } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(req.session.user.id);

  if (req.rateLimitExceeded) {
    return renderAccount(req, res, { error: 'Too many attempts. Please wait 15 minutes and try again, or log out and use "Forgot Password?".' });
  }
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    return renderAccount(req, res, { error: 'Your current password is incorrect. Your password was not changed.' });
  }
  changePasswordLimiter.reset(req);
  if (newPassword !== confirmPassword) {
    return renderAccount(req, res, { error: 'The new passwords do not match.' });
  }
  const failures = getPasswordRequirementFailures(newPassword);
  if (failures.length) {
    return renderAccount(req, res, { error: `Your new password must include ${failures.join(', ')}.` });
  }
  if (bcrypt.compareSync(newPassword, user.password_hash)) {
    return renderAccount(req, res, { error: 'Your new password must be different from your current one.' });
  }

  // Bumping session_version logs the account out on every other device; this device
  // stays logged in by taking the new version into its own session.
  db.prepare('UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE user_id = ?')
    .run(bcrypt.hashSync(newPassword, 10), user.user_id);
  req.session.user.sessionVersion = user.session_version + 1;
  logActivity('Password changed', user.full_name, customerActor(user.full_name));
  notify(user.user_id, 'system', 'Your password was changed. If this wasn\'t you, reset your password and contact us.');
  sendPasswordChangedEmail(user).catch(err => console.error('Password-changed email failed:', err.message));

  renderAccount(req, res, { success: 'Your password has been changed. You have been logged out on your other devices.' });
});

router.post('/account/newsletter', redirectAdminAway, requireLogin, (req, res) => {
  const email = String(req.session.user.email).toLowerCase();
  const row = db.prepare('SELECT id, status FROM newsletter_subscribers WHERE email = ?').get(email);

  if (req.body.subscribe === 'yes') {
    if (row) {
      db.prepare("UPDATE newsletter_subscribers SET status = 'confirmed', confirmed_at = datetime('now'), unsubscribed_at = NULL, source = 'account page' WHERE id = ?").run(row.id);
    } else {
      db.prepare("INSERT INTO newsletter_subscribers (email, status, token, source, confirmed_at) VALUES (?, 'confirmed', ?, 'account page', datetime('now'))")
        .run(email, crypto.randomBytes(24).toString('hex'));
    }
    logActivity('Newsletter subscribed', req.session.user.fullName, customerActor(req.session.user.fullName));
    return renderAccount(req, res, { success: "You're subscribed to the Cultured Africa newsletter." });
  }

  if (row && row.status !== 'unsubscribed') {
    db.prepare("UPDATE newsletter_subscribers SET status = 'unsubscribed', unsubscribed_at = datetime('now') WHERE id = ?").run(row.id);
    logActivity('Newsletter unsubscribed', req.session.user.fullName, customerActor(req.session.user.fullName));
  }
  renderAccount(req, res, { success: "You've been unsubscribed from the newsletter." });
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
  db.prepare('DELETE FROM newsletter_subscribers WHERE email = ?').run(String(user.email).toLowerCase());
  logActivity('Account deleted', user.full_name, customerActor(user.full_name));

  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
