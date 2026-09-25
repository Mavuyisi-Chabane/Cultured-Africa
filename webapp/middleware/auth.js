function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  res.locals.currentUser = req.session.user;
  next();
}

// Admin identity lives entirely in req.session.admin (backed by the `admins` table),
// separate from the customer req.session.user — see db/schema.sql's admins table.
function requireAdmin(req, res, next) {
  if (!req.session.admin) {
    return res.redirect('/admin/login');
  }
  res.locals.currentAdmin = req.session.admin;
  next();
}

function requireSuperAdmin(req, res, next) {
  if (!req.session.admin) {
    return res.redirect('/admin/login');
  }
  if (req.session.admin.role !== 'super_admin') {
    return res.status(403).send('Forbidden — super admin access required.');
  }
  res.locals.currentAdmin = req.session.admin;
  next();
}

// Keeps the customer and admin sides of the app fully separate: an admin session
// should never render a customer-facing page (e.g. after a refresh, a back-button
// navigation, or a stale bookmark to "/"). Sends them to the admin dashboard instead.
function redirectAdminAway(req, res, next) {
  if (req.session.admin) {
    return res.redirect('/admin/dashboard');
  }
  next();
}

module.exports = { requireLogin, requireAdmin, requireSuperAdmin, redirectAdminAway };
