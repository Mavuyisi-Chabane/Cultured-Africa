const express = require('express');
const bcrypt = require('bcryptjs');
const store = require('../data/store');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { error: null });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = store.users.find(u => u.email.toLowerCase() === (email || '').toLowerCase());

  if (!user || !bcrypt.compareSync(password || '', user.passwordHash)) {
    return res.render('login', { error: 'Incorrect email or password.' });
  }

  req.session.user = { id: user.id, fullName: user.fullName, email: user.email, role: user.role, avatar: user.avatar };
  res.redirect(user.role === 'admin' ? '/admin/dashboard' : '/');
});

router.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('register', { error: null, values: {} });
});

router.post('/register', (req, res) => {
  const { fullName, email, password, confirm } = req.body;

  if (!fullName || !email || !password) {
    return res.render('register', { error: 'All fields are required.', values: req.body });
  }
  if (password !== confirm) {
    return res.render('register', { error: 'Passwords do not match.', values: req.body });
  }
  if (store.users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
    return res.render('register', { error: 'An account with that email already exists.', values: req.body });
  }

  const user = {
    id: store.nextIds.nextUserId(),
    fullName,
    email,
    passwordHash: bcrypt.hashSync(password, 10),
    role: 'member',
    avatar: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/avatars/avatar-4.jpg'
  };
  store.users.push(user);
  store.logActivity('New user registered', user.fullName);

  req.session.user = { id: user.id, fullName: user.fullName, email: user.email, role: user.role, avatar: user.avatar };
  res.redirect('/');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
