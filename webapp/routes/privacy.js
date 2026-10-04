const express = require('express');
const { db, logActivity, customerActor } = require('../db');
const { requireLogin, redirectAdminAway } = require('../middleware/auth');
const { PRIVACY_POLICY_VERSION, PRIVACY_POLICY_UPDATED } = require('../config/privacy');

const router = express.Router();

function recordConsent(userId) {
  db.prepare("UPDATE users SET privacy_consent_at = datetime('now'), privacy_policy_version = ? WHERE user_id = ?")
    .run(PRIVACY_POLICY_VERSION, userId);
}

router.get('/privacy', (req, res) => {
  res.render('privacy', { policyUpdated: PRIVACY_POLICY_UPDATED });
});

// Shown to a logged-in customer with no consent on record for the current policy
// version (existing accounts from before consent was collected, or after the policy
// changes) — server.js redirects every other page here until they decide.
router.get('/consent', redirectAdminAway, requireLogin, (req, res) => {
  const row = db.prepare('SELECT privacy_policy_version FROM users WHERE user_id = ?').get(req.session.user.id);
  if (row && row.privacy_policy_version === PRIVACY_POLICY_VERSION) return res.redirect('/');
  res.render('consent', {
    policyUpdated: PRIVACY_POLICY_UPDATED,
    isUpdate: Boolean(row && row.privacy_policy_version),
    error: null
  });
});

router.post('/consent', redirectAdminAway, requireLogin, (req, res) => {
  if (req.body.decision === 'decline') {
    // Declining means we may not keep processing their data through the site, so log
    // them out. Their account stays until they delete it (or ask us to).
    return req.session.destroy(() => res.redirect('/login?consent=declined'));
  }
  if (req.body.privacyConsent !== 'yes') {
    return res.render('consent', {
      policyUpdated: PRIVACY_POLICY_UPDATED,
      isUpdate: false,
      error: 'Please tick the box to confirm you agree, or choose "No, log me out".'
    });
  }
  recordConsent(req.session.user.id);
  logActivity('Privacy consent given', req.session.user.fullName, customerActor(req.session.user.fullName));
  res.redirect('/');
});

module.exports = router;
module.exports.recordConsent = recordConsent;
