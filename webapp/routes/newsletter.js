const express = require('express');
const crypto = require('crypto');
const { db, logActivity } = require('../db');
const { createRateLimiter } = require('../middleware/rateLimit');
const { sendNewsletterConfirmation } = require('../services/email');

// Newsletter sign-up with double opt-in, as POPIA expects for direct marketing by email:
// signing up only sends a confirmation email, and the address is subscribed once its
// owner clicks the link in it. Every email carries a one-click unsubscribe link.
const router = express.Router();

const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const signupLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 5, keyFn: req => `newsletter:${req.ip}` });

function newToken() {
  return crypto.randomBytes(24).toString('hex');
}

// The same reply whatever happens, so the form can't be used to find out who subscribes.
router.post('/newsletter', signupLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase().slice(0, 254);
  if (req.rateLimitExceeded) return res.redirect('/?newsletter=busy#newsletter');
  if (!EMAIL_FORMAT.test(email)) return res.redirect('/?newsletter=invalid#newsletter');

  const existing = db.prepare('SELECT * FROM newsletter_subscribers WHERE email = ?').get(email);
  if (!existing || existing.status !== 'confirmed') {
    const token = newToken();
    if (existing) {
      db.prepare("UPDATE newsletter_subscribers SET status = 'pending', token = ?, requested_at = datetime('now') WHERE id = ?")
        .run(token, existing.id);
    } else {
      db.prepare("INSERT INTO newsletter_subscribers (email, status, token, source) VALUES (?, 'pending', ?, 'website footer')")
        .run(email, token);
    }
    try {
      await sendNewsletterConfirmation(email, token);
    } catch (err) {
      console.error('Newsletter confirmation email failed:', err.message);
    }
  }
  res.redirect('/?newsletter=sent#newsletter');
});

function renderResult(res, status, title, message) {
  res.status(status).render('newsletter-result', { title, message, ok: status === 200 });
}

router.get('/newsletter/confirm', (req, res) => {
  const row = db.prepare('SELECT * FROM newsletter_subscribers WHERE token = ?').get(String(req.query.token || ''));
  if (!row) {
    return renderResult(res, 404, 'Link not valid', 'This confirmation link is no longer valid. You can sign up again from the bottom of our home page.');
  }
  if (row.status !== 'confirmed') {
    db.prepare("UPDATE newsletter_subscribers SET status = 'confirmed', confirmed_at = datetime('now'), unsubscribed_at = NULL WHERE id = ?").run(row.id);
    logActivity('Newsletter subscribed', row.email, null);
  }
  renderResult(res, 200, "You're subscribed", "Thanks for confirming. We'll email you about new films and news from Cultured Africa. Every email has a link to unsubscribe.");
});

router.get('/newsletter/unsubscribe', (req, res) => {
  const row = db.prepare('SELECT * FROM newsletter_subscribers WHERE token = ?').get(String(req.query.token || ''));
  if (!row) {
    return renderResult(res, 404, 'Link not valid', "This unsubscribe link isn't valid. If you keep receiving emails, contact info@culturedafrica.co.za.");
  }
  if (row.status !== 'unsubscribed') {
    db.prepare("UPDATE newsletter_subscribers SET status = 'unsubscribed', unsubscribed_at = datetime('now') WHERE id = ?").run(row.id);
    logActivity('Newsletter unsubscribed', row.email, null);
  }
  renderResult(res, 200, "You've been unsubscribed", "You won't receive any more newsletter emails from Cultured Africa. Your account, if you have one, is not affected.");
});

module.exports = router;
