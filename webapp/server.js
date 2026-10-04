require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const paystack = require('./config/paystack');
const { PRIVACY_POLICY_VERSION } = require('./config/privacy');
const { db } = require('./db');
const SqliteSessionStore = require('./middleware/sessionStore');
const csrfProtection = require('./middleware/csrf');
const securityHeaders = require('./middleware/securityHeaders');
const uploadsAccess = require('./middleware/uploadsAccess');
const { APP_BASE_URL } = require('./config/email');

const authRoutes = require('./routes/auth');
const accountRoutes = require('./routes/account');
const filmRoutes = require('./routes/films');
const adminAuthRoutes = require('./routes/adminAuth');
const adminRoutes = require('./routes/admin');
const adminManageRoutes = require('./routes/adminManage');
const notificationRoutes = require('./routes/notifications');
const privacyRoutes = require('./routes/privacy');
const newsletterRoutes = require('./routes/newsletter');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Pages a logged-in customer can still reach before agreeing to the privacy policy:
// the consent screen itself, the policy, logging out, and deleting their account.
const CONSENT_EXEMPT_PATHS = new Set(['/consent', '/privacy', '/purchase-terms', '/newsletter/confirm', '/newsletter/unsubscribe', '/logout', '/account', '/account/delete', '/about']);

// Refuse to run in production with a guessable session secret: anyone who knows it can
// forge a logged-in session cookie for any user or admin.
if (IS_PRODUCTION && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  console.error('SESSION_SECRET must be set to a random string of at least 32 characters in production. Not starting.');
  process.exit(1);
}
if (IS_PRODUCTION && /localhost|trycloudflare.com/.test(APP_BASE_URL)) {
  console.warn(`APP_BASE_URL is ${APP_BASE_URL} — links in emails (verification, password reset) will not work for customers. Set it to the site's real address.`);
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Render (and most PaaS hosts) terminate TLS at a proxy in front of the app, so
// Express needs this to know the original request was HTTPS — otherwise secure
// cookies below would never actually get set.
app.set('trust proxy', 1);

app.disable('x-powered-by');
app.use(securityHeaders(IS_PRODUCTION));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(express.json({ limit: '100kb' }));
app.use('/images', express.static(path.join(__dirname, 'public', 'images')));

// For the host's uptime checks: confirms the app is running and the database answers.
app.get('/health', (req, res) => {
  db.prepare('SELECT 1').get();
  res.json({ status: 'ok' });
});

app.use(session({
  name: 'ca.sid',
  secret: process.env.SESSION_SECRET || 'culturedafrica-dev-secret',
  store: new SqliteSessionStore(db),
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 4, secure: IS_PRODUCTION, httpOnly: true, sameSite: 'lax' }
}));
app.use('/uploads', uploadsAccess(db));

app.use((req, res, next) => {
  // If the password was reset (here or on another device) since this session's cookie
  // was issued, session_version will have moved on — force this session out rather
  // than trusting the stale copy cached in the cookie at login time. Clearing
  // req.session.user (rather than req.session.destroy()) keeps req.session itself
  // intact for the rest of this request, since every downstream route assumes
  // req.session always exists.
  if (req.session.user) {
    const current = db.prepare('SELECT session_version, privacy_policy_version, status, adult_confirmed_at FROM users WHERE user_id = ?').get(req.session.user.id);
    // A suspension (Admin > Customers) takes effect on the customer's very next request.
    if (!current || current.session_version !== req.session.user.sessionVersion || current.status === 'suspended') {
      req.session.user = null;
    } else {
      // Kept current from the database, so the 18+ confirmation applies on every device.
      req.session.user.adultConfirmed = Boolean(current.adult_confirmed_at);
    }

    if (req.session.user && current.privacy_policy_version !== PRIVACY_POLICY_VERSION && !CONSENT_EXEMPT_PATHS.has(req.path)) {
      // POPIA: no further processing of a customer's data (browsing, purchases, watch
      // tracking) until they have agreed to the current privacy policy.
      if (req.method === 'GET') return res.redirect('/consent');
      return res.status(403).render('error', {
        status: 403, title: 'Privacy Policy not accepted', message: 'Please accept the Privacy Policy before continuing.',
        currentUser: req.session.user, currentAdmin: null
      });
    }
  }

  // Re-validated against the DB on every request (rather than trusting a cached
  // session_version like the customer check above) so a deactivation or role change
  // takes effect on the admin's very next request, not just their next login.
  if (req.session.admin) {
    const current = db.prepare('SELECT admin_id, name, email, role, status FROM admins WHERE admin_id = ?').get(req.session.admin.id);
    if (!current || current.status !== 'active') {
      req.session.admin = null;
    } else {
      req.session.admin = { id: current.admin_id, name: current.name, email: current.email, role: current.role };
    }
  }

  res.locals.currentUser = req.session.user || null;
  res.locals.currentAdmin = req.session.admin || null;
  res.locals.paystackPublicKey = paystack.PAYSTACK_PUBLIC_KEY;
  res.locals.paystackCurrency = paystack.PAYSTACK_CURRENCY;
  res.locals.unreadNotifications = req.session.user
    ? db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0').get(req.session.user.id).n
    : 0;
  next();
});

app.use(csrfProtection);

app.get('/about', (req, res) => {
  res.render('about');
});

app.use('/', privacyRoutes);
app.use('/', newsletterRoutes);
app.use('/', authRoutes);
app.use('/', accountRoutes);
app.use('/', filmRoutes);
app.use('/', notificationRoutes);
app.use('/admin', adminAuthRoutes);
app.use('/admin', adminManageRoutes);
app.use('/admin', adminRoutes);

app.use((req, res) => {
  res.status(404).render('error', {
    status: 404,
    title: 'Page not found',
    message: "We couldn't find the page you were looking for. It may have moved, or the link may be wrong."
  });
});

// Last resort for anything that throws: log the details for us, show the visitor a
// friendly page — never a stack trace or internal error message.
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);
  if (res.headersSent) return next(err);
  res.locals.currentUser = res.locals.currentUser || null;
  res.locals.currentAdmin = res.locals.currentAdmin || null;
  res.status(status).render('error', status === 404
    ? { status, title: 'Page not found', message: "We couldn't find what you were looking for." }
    : { status, title: 'Something went wrong', message: 'Sorry, something went wrong on our side. Please try again in a moment.' });
});

app.listen(PORT, () => {
  console.log(`Cultured Africa running at http://localhost:${PORT}`);
  if (!paystack.isConfigured) {
    console.warn('Paystack keys not set — copy .env.example to .env and add your keys to enable payments.');
  }
});
