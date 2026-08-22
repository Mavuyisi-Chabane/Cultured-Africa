const express = require('express');
const bcrypt = require('bcryptjs');
const { db, logActivity, notify } = require('../db');
const { issueVerificationToken, hashToken } = require('../utils/verification');
const { issuePasswordResetToken } = require('../utils/passwordReset');
const { getPasswordRequirementFailures } = require('../utils/password');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../services/email');
const { createRateLimiter } = require('../middleware/rateLimit');

const router = express.Router();

// 5 requests per 15 minutes per IP+email combo — generous enough for a genuine user
// who mistypes or wants a fresh link, tight enough to blunt automated abuse.
const forgotPasswordLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyFn: req => `${req.ip}:${(req.body.email || '').trim().toLowerCase()}`
});

// 8 code-verification attempts per 15 minutes per IP+email — a 6-digit code is only
// 1,000,000 possibilities, so this (plus expiry, plus single-use) is what keeps it
// safe against brute-forcing, not the code's size alone.
const verifyEmailLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 8,
  keyFn: req => `${req.ip}:${(req.body.email || '').trim().toLowerCase()}`
});

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { error: null, showResend: false, resendEmail: '' });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email || '');

  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.render('login', { error: 'Incorrect email or password.', showResend: false, resendEmail: '' });
  }

  if (!user.is_verified) {
    return res.render('login', {
      error: 'Please verify your email before logging in. Check your inbox for the verification code, or request a new one below.',
      showResend: true,
      resendEmail: user.email
    });
  }

  req.session.user = {
    id: user.user_id, fullName: user.full_name, email: user.email, role: user.role,
    avatar: user.avatar, sessionVersion: user.session_version
  };
  res.redirect(user.role === 'admin' ? '/admin/dashboard' : '/');
});

router.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('register', { error: null, values: {} });
});

router.post('/register', async (req, res) => {
  const { fullName, email, password, confirm } = req.body;

  if (!fullName || !email || !password) {
    return res.render('register', { error: 'All fields are required.', values: req.body });
  }
  if (password !== confirm) {
    return res.render('register', { error: 'Passwords do not match.', values: req.body });
  }
  const passwordFailures = getPasswordRequirementFailures(password);
  if (passwordFailures.length > 0) {
    return res.render('register', { error: `Password must include ${passwordFailures.join(', ')}.`, values: req.body });
  }
  const existing = db.prepare('SELECT user_id FROM users WHERE lower(email) = lower(?)').get(email);
  if (existing) {
    return res.render('register', { error: 'An account with that email already exists.', values: req.body });
  }

  const avatar = 'https://storage.googleapis.com/uxpilot-auth.appspot.com/avatars/avatar-4.jpg';
  const passwordHash = bcrypt.hashSync(password, 10);
  const userId = db.prepare(`
    INSERT INTO users (full_name, email, password_hash, is_verified, role, avatar)
    VALUES (?, ?, ?, 0, 'customer', ?)
  `).run(fullName, email, passwordHash, avatar).lastInsertRowid;

  logActivity('New user registered', fullName);

  const code = issueVerificationToken(userId);
  try {
    await sendVerificationEmail({ email, full_name: fullName }, code);
  } catch (err) {
    console.error('Failed to send verification email:', err.message);
  }

  res.render('verify-pending', { email, resent: false, error: null });
});

router.get('/verify-email', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('verify-pending', { email: '', resent: false, error: null });
});

router.post('/verify-email', verifyEmailLimiter, (req, res) => {
  const email = (req.body.email || '').trim();
  const code = (req.body.code || '').trim();

  if (req.rateLimitExceeded) {
    return res.render('verify-pending', { email, resent: false, error: 'Too many attempts. Please wait a while before trying again.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email);
  if (!user) {
    return res.render('verify-pending', { email, resent: false, error: 'No account found with that email address.' });
  }
  if (user.is_verified) {
    return res.render('verify-result', { status: 'already-verified', email: user.email });
  }
  if (!/^\d{6}$/.test(code)) {
    return res.render('verify-pending', { email, resent: false, error: 'Please enter the 6-digit code exactly as it appears in the email.' });
  }

  // Scoped by user_id, not by hash alone — codes are short enough that two users
  // could coincidentally be issued the same one.
  const row = db.prepare(`
    SELECT token_id, token_hash, (expires_at <= datetime('now')) AS is_expired
    FROM email_verification_tokens
    WHERE user_id = ? AND used = 0
    ORDER BY token_id DESC LIMIT 1
  `).get(user.user_id);

  if (!row) {
    return res.render('verify-pending', { email, resent: false, error: 'No pending verification code for this account. Request a new one below.' });
  }
  if (row.is_expired) {
    return res.render('verify-result', { status: 'expired', email: user.email });
  }
  if (hashToken(code) !== row.token_hash) {
    return res.render('verify-pending', { email, resent: false, error: 'Incorrect code. Please check your email and try again.' });
  }

  // Mark single-use immediately — this code can never be replayed, even if the
  // request is somehow repeated before the response is returned.
  db.prepare('UPDATE email_verification_tokens SET used = 1 WHERE token_id = ?').run(row.token_id);
  db.prepare('UPDATE users SET is_verified = 1 WHERE user_id = ?').run(user.user_id);

  logActivity('Email verified', user.full_name);
  notify(user.user_id, 'system', `Welcome to Cultured Africa, ${user.full_name}! Start exploring films from across South Africa's cultures.`);

  res.render('verify-result', { status: 'success', email: user.email });
});

router.post('/resend-verification', async (req, res) => {
  const email = (req.body.email || '').trim();
  const user = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email);

  if (!user) {
    return res.render('verify-result', { status: 'resend-not-found', email });
  }
  if (user.is_verified) {
    return res.render('verify-result', { status: 'already-verified', email: user.email });
  }

  const code = issueVerificationToken(user.user_id);
  try {
    await sendVerificationEmail(user, code);
  } catch (err) {
    console.error('Failed to send verification email:', err.message);
    return res.render('verify-result', { status: 'send-failed', email: user.email });
  }

  res.render('verify-pending', { email: user.email, resent: true, error: null });
});

router.get('/forgot-password', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('forgot-password', { error: null, submitted: false, email: '' });
});

router.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
  const email = (req.body.email || '').trim();

  if (req.rateLimitExceeded) {
    return res.render('forgot-password', {
      error: 'Too many requests. Please wait a while before trying again.',
      submitted: false,
      email
    });
  }

  const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!EMAIL_FORMAT.test(email)) {
    return res.render('forgot-password', { error: 'Please enter a valid email address.', submitted: false, email });
  }

  // Always render the same success state whether or not the account exists —
  // never reveal account existence through the response.
  const user = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email);
  if (user) {
    const rawToken = issuePasswordResetToken(user.user_id);
    try {
      await sendPasswordResetEmail(user, rawToken);
    } catch (err) {
      console.error('Failed to send password reset email:', err.message);
    }
  }

  res.render('forgot-password', { error: null, submitted: true, email });
});

router.get('/reset-password', (req, res) => {
  const rawToken = req.query.token;
  if (!rawToken || typeof rawToken !== 'string') {
    return res.render('reset-password', { status: 'invalid', token: null, error: null });
  }

  const tokenHash = hashToken(rawToken);
  const row = db.prepare(`
    SELECT id, used_at, (expires_at <= datetime('now')) AS is_expired
    FROM password_reset_tokens WHERE token_hash = ?
  `).get(tokenHash);

  if (!row || row.used_at) {
    return res.render('reset-password', { status: 'invalid', token: null, error: null });
  }
  if (row.is_expired) {
    return res.render('reset-password', { status: 'expired', token: null, error: null });
  }

  res.render('reset-password', { status: 'form', token: rawToken, error: null });
});

router.post('/reset-password', (req, res) => {
  const { token, password, confirm } = req.body;

  function reRenderForm(error) {
    res.render('reset-password', { status: 'form', token: token || '', error });
  }

  if (!token || typeof token !== 'string') {
    return res.render('reset-password', { status: 'invalid', token: null, error: null });
  }

  const tokenHash = hashToken(token);
  const row = db.prepare(`
    SELECT prt.id, prt.user_id, prt.used_at, (prt.expires_at <= datetime('now')) AS is_expired
    FROM password_reset_tokens prt WHERE prt.token_hash = ?
  `).get(tokenHash);

  if (!row || row.used_at) {
    return res.render('reset-password', { status: 'invalid', token: null, error: null });
  }
  if (row.is_expired) {
    return res.render('reset-password', { status: 'expired', token: null, error: null });
  }

  if (!password) {
    return reRenderForm('Password is required.');
  }
  if (password !== confirm) {
    return reRenderForm('Passwords do not match.');
  }
  const passwordFailures = getPasswordRequirementFailures(password);
  if (passwordFailures.length > 0) {
    return reRenderForm(`Password must include ${passwordFailures.join(', ')}.`);
  }

  const passwordHash = bcrypt.hashSync(password, 10);

  // Mark this token used, invalidate any other still-active reset tokens for this user,
  // update the password, and bump session_version so every existing session for this
  // user (including ones on other devices) stops being accepted on its next request.
  db.prepare("UPDATE password_reset_tokens SET used_at = datetime('now') WHERE id = ?").run(row.id);
  db.prepare("UPDATE password_reset_tokens SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL").run(row.user_id);
  db.prepare('UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE user_id = ?')
    .run(passwordHash, row.user_id);

  const user = db.prepare('SELECT full_name FROM users WHERE user_id = ?').get(row.user_id);
  logActivity('Password reset', user.full_name);
  notify(row.user_id, 'system', 'Your password was just changed. If this wasn\'t you, please contact support immediately.');

  res.render('reset-password', { status: 'success', token: null, error: null });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
