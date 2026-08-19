function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  res.locals.currentUser = req.session.user;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  if (req.session.user.role !== 'admin') {
    return res.status(403).send('Forbidden — admin access required.');
  }
  res.locals.currentUser = req.session.user;
  next();
}

module.exports = { requireLogin, requireAdmin };
