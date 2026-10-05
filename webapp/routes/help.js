const express = require('express');
const { logActivity, customerActor } = require('../db');
const business = require('../config/business');
const purchaseTerms = require('../config/purchaseTerms');
const { ACCESS_MONTHS } = require('../config/access');
const { AGE_RATINGS, CONTENT_ADVISORIES } = require('../config/ageRatings');
const { createRateLimiter } = require('../middleware/rateLimit');
const { sendContactMessage } = require('../services/email');

const router = express.Router();

const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTACT_TOPICS = ['Billing or refunds', 'A film won\'t play', 'My account', 'Suggest a film or culture', 'Something else'];

// Contact form: 5 messages per hour per connection, so it can't be used to flood the inbox.
const contactLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 5, keyFn: req => `contact:${req.ip}` });

router.get('/help', (req, res) => {
  res.render('help', { business, terms: purchaseTerms, accessMonths: ACCESS_MONTHS, ageRatings: AGE_RATINGS, contentAdvisories: CONTENT_ADVISORIES });
});

function renderContact(req, res, state = {}) {
  const user = req.session.user;
  res.render('contact', {
    business,
    topics: CONTACT_TOPICS,
    values: { name: user ? user.fullName : '', email: user ? user.email : '', topic: req.query.topic || '', message: '' },
    error: null,
    sent: false,
    ...state
  });
}

router.get('/contact', (req, res) => renderContact(req, res));

router.post('/contact', contactLimiter, async (req, res) => {
  const values = {
    name: String(req.body.name || '').trim().slice(0, 80),
    email: String(req.body.email || '').trim().slice(0, 254),
    topic: String(req.body.topic || ''),
    message: String(req.body.message || '').trim()
  };
  // Hidden field real visitors never fill in; automated spam usually does.
  if (req.body.website) return renderContact(req, res, { sent: true });

  const fail = error => renderContact(req, res, { values, error });
  if (req.rateLimitExceeded) return fail(`You've sent several messages already. Please wait an hour, or email us at ${business.BUSINESS_EMAIL}.`);
  if (!values.name) return fail('Please enter your name.');
  if (!EMAIL_FORMAT.test(values.email)) return fail('Please enter a valid email address so we can reply.');
  if (!CONTACT_TOPICS.includes(values.topic)) return fail('Please choose what your message is about.');
  if (values.message.length < 10) return fail('Please tell us a little more (at least 10 characters).');
  if (values.message.length > 3000) return fail('Please keep your message under 3000 characters.');

  try {
    await sendContactMessage({ ...values, accountEmail: req.session.user ? req.session.user.email : null });
  } catch (err) {
    console.error('Contact form email failed:', err.message);
    return fail(`Sorry, your message couldn't be sent right now. Please email us directly at ${business.BUSINESS_EMAIL}.`);
  }
  logActivity('Contact form message', values.topic, req.session.user ? customerActor(req.session.user.fullName) : { name: values.name, role: 'visitor' });
  renderContact(req, res, { sent: true, values });
});

module.exports = router;
