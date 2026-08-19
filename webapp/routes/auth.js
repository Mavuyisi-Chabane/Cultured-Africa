const express = require('express');
const bcrypt = require('bcryptjs');
const { db, logActivity } = require('../db');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { error: null });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email || '');

  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.render('login', { error: 'Incorrect email or password.' });
  }

  req.session.user = { id: user.id, fullName: user.full_name, email: user.email, role: user.role, avatar: user.avatar };
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
  const existing = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(email);
  if (existing) {
    return res.render('register', { error: 'An account with that email already exists.', values: req.body });
  }

  const avatar = 'https://storage.googleapis.com/uxpilot-auth.appspot.com/avatars/avatar-4.jpg';
  const passwordHash = bcrypt.hashSync(password, 10);
  const userId = db.prepare(`
    INSERT INTO users (full_name, email, password_hash, role, avatar)
    VALUES (?, ?, ?, 'member', ?)
  `).run(fullName, email, passwordHash, avatar).lastInsertRowid;

  logActivity('New user registered', fullName);

  req.session.user = { id: userId, fullName, email, role: 'member', avatar };
  res.redirect('/');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
