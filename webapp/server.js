require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const paystack = require('./config/paystack');

const authRoutes = require('./routes/auth');
const filmRoutes = require('./routes/films');
const adminRoutes = require('./routes/admin');

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
  res.locals.currentUser = req.session.user || null;
  res.locals.paystackPublicKey = paystack.PAYSTACK_PUBLIC_KEY;
  res.locals.paystackCurrency = paystack.PAYSTACK_CURRENCY;
  next();
});

app.get('/about', (req, res) => {
  res.render('about');
});

app.use('/', authRoutes);
app.use('/', filmRoutes);
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
