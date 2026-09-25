require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const paystack = require('./config/paystack');
const { db } = require('./db');
const handleUploads = require('./middleware/upload');

const authRoutes = require('./routes/auth');
const accountRoutes = require('./routes/account');
const filmRoutes = require('./routes/films');
const adminAuthRoutes = require('./routes/adminAuth');
const adminRoutes = require('./routes/admin');
const notificationRoutes = require('./routes/notifications');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

if (IS_PRODUCTION && !process.env.SESSION_SECRET) {
  console.warn('SESSION_SECRET is not set — using an insecure default. Set it in your host\'s environment variables.');
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Render (and most PaaS hosts) terminate TLS at a proxy in front of the app, so
// Express needs this to know the original request was HTTPS — otherwise secure
// cookies below would never actually get set.
app.set('trust proxy', 1);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/uploads', express.static(handleUploads.UPLOAD_DIR));
app.use(session({
  secret: process.env.SESSION_SECRET || 'culturedafrica-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 4, secure: IS_PRODUCTION }
}));

app.use((req, res, next) => {
  // If the password was reset (here or on another device) since this session's cookie
  // was issued, session_version will have moved on — force this session out rather
  // than trusting the stale copy cached in the cookie at login time. Clearing
  // req.session.user (rather than req.session.destroy()) keeps req.session itself
  // intact for the rest of this request, since every downstream route assumes
  // req.session always exists.
  if (req.session.user) {
    const current = db.prepare('SELECT session_version FROM users WHERE user_id = ?').get(req.session.user.id);
    if (!current || current.session_version !== req.session.user.sessionVersion) {
      req.session.user = null;
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

app.get('/about', (req, res) => {
  res.render('about');
});

app.use('/', authRoutes);
app.use('/', accountRoutes);
app.use('/', filmRoutes);
app.use('/', notificationRoutes);
app.use('/admin', adminAuthRoutes);
app.use('/admin', adminRoutes);

app.use((req, res) => {
  res.status(404).send('Page not found.');
});

app.listen(PORT, () => {
  console.log(`Cultured Africa running at http://localhost:${PORT}`);
  if (!paystack.isConfigured) {
    console.warn('Paystack keys not set — copy .env.example to .env and add your test keys to enable payments.');
  }
});
