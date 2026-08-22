require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const paystack = require('./config/paystack');
const { db } = require('./db');

const authRoutes = require('./routes/auth');
const filmRoutes = require('./routes/films');
const adminRoutes = require('./routes/admin');
const notificationRoutes = require('./routes/notifications');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'culturedafrica-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 4 }
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

  res.locals.currentUser = req.session.user || null;
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
app.use('/', filmRoutes);
app.use('/', notificationRoutes);
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
