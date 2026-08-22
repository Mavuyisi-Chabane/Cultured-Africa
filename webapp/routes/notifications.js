const express = require('express');
const { db } = require('../db');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

router.get('/notifications', requireLogin, (req, res) => {
  const notifications = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY sent_date DESC')
    .all(req.session.user.id)
    .map(n => ({
      id: n.notification_id,
      type: n.type,
      message: n.message,
      isRead: Boolean(n.is_read),
      sentAt: new Date(n.sent_date)
    }));

  res.render('notifications', { notifications });
});

router.post('/notifications/mark-all-read', requireLogin, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.session.user.id);
  res.redirect('/notifications');
});

module.exports = router;
