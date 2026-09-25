const express = require('express');
const bcrypt = require('bcryptjs');
const { db, logAudit } = require('../db');
const { getPasswordRequirementFailures } = require('../utils/password');
const { hashInviteCode, MAX_INVITE_ATTEMPTS } = require('../utils/adminInvites');

const router = express.Router();

function findAdminByEmail(email) {
  return db.prepare('SELECT * FROM admins WHERE lower(email) = lower(?)').get(email || '');
}

function findPendingInvite(email) {
  const invite = db.prepare(`
    SELECT * FROM admin_invites WHERE lower(email) = lower(?) AND status = 'pending' ORDER BY id DESC LIMIT 1
  `).get(email || '');
  if (!invite) return null;

  if (invite.expires_at <= new Date().toISOString().slice(0, 19).replace('T', ' ')) {
    db.prepare("UPDATE admin_invites SET status = 'expired' WHERE id = ?").run(invite.id);
    return null;
  }
  return invite;
}

function render(res, state) {
  res.render('admin-login', {
    step: 'email',
    email: '',
    name: '',
    error: null,
    attemptsLeft: null,
    ...state
  });
}

router.get('/login', (req, res) => {
  if (req.session.admin) return res.redirect('/admin/dashboard');

  if (req.query.reset === '1') {
    req.session.adminOnboarding = null;
    return render(res, { step: 'email' });
  }

  const onboarding = req.session.adminOnboarding;
  if (onboarding && onboarding.verified) {
    return render(res, { step: 'setPassword', email: onboarding.email });
  }
  if (onboarding && onboarding.email) {
    return render(res, { step: 'code', email: onboarding.email, name: onboarding.name });
  }
  render(res, { step: 'email' });
});

// Step 1: figure out which of the three cases this email falls into.
router.post('/login/continue', (req, res) => {
  const email = (req.body.email || '').trim();
  if (!email) return render(res, { step: 'email', error: 'Please enter your email address.' });

  const admin = findAdminByEmail(email);

  if (!admin) {
    req.session.adminOnboarding = null;
    return render(res, { step: 'email', email, error: 'No account found with that email address.' });
  }

  if (admin.password_hash) {
    req.session.adminOnboarding = null;
    return render(res, { step: 'password', email });
  }

  // password_hash is NULL: this admin_id was reserved by an invite but not yet verified.
  const invite = findPendingInvite(email);
  if (!invite) {
    return render(res, { step: 'email', email, error: 'This invite has expired or is no longer valid. Please ask your super admin to resend it.' });
  }

  req.session.adminOnboarding = { email, name: invite.name, verified: false };
  render(res, { step: 'code', email, name: invite.name });
});

// Case 1: existing verified admin logging in with a password.
router.post('/login/password', (req, res) => {
  const email = (req.body.email || '').trim();
  const password = req.body.password || '';
  const admin = findAdminByEmail(email);

  if (!admin || !admin.password_hash || !bcrypt.compareSync(password, admin.password_hash)) {
    return render(res, { step: 'password', email, error: 'Incorrect email or password.' });
  }
  if (admin.status !== 'active') {
    return render(res, { step: 'password', email, error: 'This admin account has been deactivated. Contact a super admin.' });
  }

  req.session.admin = { id: admin.admin_id, name: admin.name, email: admin.email, role: admin.role };
  req.session.adminOnboarding = null;
  res.redirect('/admin/dashboard');
});

// Case 2, step A: verify the 6-digit invite code.
router.post('/login/verify-code', (req, res) => {
  const email = (req.body.email || '').trim();
  const code = (req.body.code || '').trim();

  const invite = findPendingInvite(email);
  if (!invite) {
    req.session.adminOnboarding = null;
    return render(res, { step: 'email', email, error: 'This invite has expired or is no longer valid. Please ask your super admin to resend it.' });
  }

  if (hashInviteCode(code) !== invite.code_hash) {
    const attempts = invite.attempts + 1;
    if (attempts >= MAX_INVITE_ATTEMPTS) {
      db.prepare("UPDATE admin_invites SET status = 'expired', attempts = ? WHERE id = ?").run(attempts, invite.id);
      req.session.adminOnboarding = null;
      return render(res, { step: 'email', email, error: 'Too many incorrect attempts. Ask your super admin to resend the invite.' });
    }
    db.prepare('UPDATE admin_invites SET attempts = ? WHERE id = ?').run(attempts, invite.id);
    return render(res, {
      step: 'code', email, name: invite.name,
      error: 'Incorrect code.', attemptsLeft: MAX_INVITE_ATTEMPTS - attempts
    });
  }

  const admin = findAdminByEmail(email);
  if (!admin) {
    req.session.adminOnboarding = null;
    return render(res, { step: 'email', email, error: 'No account found with that email address.' });
  }

  db.prepare("UPDATE admin_invites SET status = 'verified' WHERE id = ?").run(invite.id);
  req.session.adminOnboarding = { email, name: invite.name, adminId: admin.admin_id, verified: true };
  render(res, { step: 'setPassword', email });
});

// Case 2, step B: set a password now that the code has been verified.
router.post('/login/set-password', (req, res) => {
  const onboarding = req.session.adminOnboarding;
  if (!onboarding || !onboarding.verified || !onboarding.adminId) {
    return render(res, { step: 'email', error: 'Please verify your email again.' });
  }

  const { password, confirm } = req.body;
  if (password !== confirm) {
    return render(res, { step: 'setPassword', email: onboarding.email, error: 'Passwords do not match.' });
  }
  const failures = getPasswordRequirementFailures(password || '');
  if (failures.length > 0) {
    return render(res, { step: 'setPassword', email: onboarding.email, error: `Password must include ${failures.join(', ')}.` });
  }

  // A super admin can cancel a not-yet-verified invite at any point (see
  // /manage-admins/:adminId/cancel-invite), including the moment between this
  // invitee verifying their code and setting a password — so the row this update
  // targets may no longer exist by the time this request lands.
  const admin = db.prepare('SELECT * FROM admins WHERE admin_id = ?').get(onboarding.adminId);
  if (!admin) {
    req.session.adminOnboarding = null;
    return render(res, { step: 'email', error: 'This invite is no longer valid. Please ask your super admin to send a new one.' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  db.prepare("UPDATE admins SET password_hash = ?, verified_at = datetime('now') WHERE admin_id = ?")
    .run(passwordHash, onboarding.adminId);
  logAudit(onboarding.adminId, 'admin_onboarded', 'admin', onboarding.adminId, null);

  req.session.admin = { id: admin.admin_id, name: admin.name, email: admin.email, role: admin.role };
  req.session.adminOnboarding = null;

  res.redirect('/admin/dashboard');
});

router.post('/logout', (req, res) => {
  req.session.admin = null;
  req.session.adminOnboarding = null;
  res.redirect('/admin/login');
});

module.exports = router;
