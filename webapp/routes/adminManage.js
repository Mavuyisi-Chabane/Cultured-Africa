const express = require('express');
const { parseDbDate } = require('../utils/dates');
const { db, logActivity, adminActor, logAudit, notify } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { validateCultureName } = require('../utils/cultureNames');

// Admin pages for managing customer accounts and culture categories.
const router = express.Router();
router.use(['/customers', '/cultures'], requireAdmin);


// Result messages are passed as short codes in the redirect URL, never as free text,
// so nobody can craft a link that shows arbitrary text on an admin page.
const CUSTOMER_MESSAGES = {
  suspended: 'Customer suspended. They have been logged out and cannot log in until reactivated.',
  reactivated: 'Customer reactivated. They can log in again.',
  'not-found': 'That customer account no longer exists.'
};
const CULTURE_MESSAGES = {
  added: 'Culture added. It is now available on the upload form and in the customer filters.',
  updated: 'Culture updated.',
  removed: 'Culture removed.',
  'not-found': 'That culture no longer exists.'
};

// ------------------------------------------------------------------ Customers

const CUSTOMER_STATUSES = { all: 'All customers', active: 'Active', suspended: 'Suspended', unverified: 'Email not verified' };
const MAX_SEARCH_LENGTH = 100;
const REASON_MAX_LENGTH = 300;

function likePattern(term) {
  return `%${term.replace(/[!%_]/g, ch => '!' + ch)}%`;
}

function getCustomer(id) {
  return db.prepare("SELECT * FROM users WHERE user_id = ? AND role = 'customer'").get(id);
}

router.get('/customers', (req, res) => {
  const filters = {
    q: String(req.query.q || '').trim().slice(0, MAX_SEARCH_LENGTH),
    status: CUSTOMER_STATUSES[req.query.status] ? req.query.status : 'all'
  };
  const where = ["u.role = 'customer'"];
  const params = [];
  if (filters.q) {
    where.push("(u.full_name LIKE ? ESCAPE '!' OR u.email LIKE ? ESCAPE '!')");
    params.push(likePattern(filters.q), likePattern(filters.q));
  }
  if (filters.status === 'active') where.push("u.status = 'active' AND u.is_verified = 1");
  if (filters.status === 'suspended') where.push("u.status = 'suspended'");
  if (filters.status === 'unverified') where.push('u.is_verified = 0');

  const customers = db.prepare(`
    SELECT u.user_id, u.full_name, u.email, u.is_verified, u.registration_date, u.status,
           u.suspended_at, u.suspension_reason,
           (SELECT COUNT(*) FROM purchases p WHERE p.user_id = u.user_id AND p.payment_status = 'completed') AS purchases,
           (SELECT COALESCE(SUM(amount_paid), 0) FROM purchases p WHERE p.user_id = u.user_id AND p.payment_status = 'completed') AS spent,
           (SELECT MAX(watch_date) FROM watch_history w WHERE w.user_id = u.user_id) AS last_watched
    FROM users u
    WHERE ${where.join(' AND ')}
    ORDER BY u.registration_date DESC
  `).all(...params).map(r => ({
    id: r.user_id,
    name: r.full_name,
    email: r.email,
    verified: Boolean(r.is_verified),
    joined: parseDbDate(r.registration_date),
    status: r.status,
    suspendedAt: parseDbDate(r.suspended_at),
    suspensionReason: r.suspension_reason,
    purchases: r.purchases,
    spent: r.spent,
    lastWatched: parseDbDate(r.last_watched)
  }));

  const totals = db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(status = 'suspended') AS suspended,
           SUM(is_verified = 0) AS unverified
    FROM users WHERE role = 'customer'
  `).get();

  const newsletter = db.prepare(`
    SELECT SUM(status = 'confirmed') AS confirmed, SUM(status = 'pending') AS pending FROM newsletter_subscribers
  `).get();

  res.render('admin-customers', {
    customers, filters, totals, newsletter,
    statusOptions: Object.entries(CUSTOMER_STATUSES).map(([value, label]) => ({ value, label })),
    message: CUSTOMER_MESSAGES[req.query.msg] || null
  });
});

// Confirmed newsletter subscribers as CSV, for importing into a mailing tool.
router.get('/customers/newsletter.csv', (req, res) => {
  const rows = db.prepare(`
    SELECT email, confirmed_at, source FROM newsletter_subscribers WHERE status = 'confirmed' ORDER BY confirmed_at
  `).all();
  const cell = v => {
    const s = String(v == null ? '' : v);
    // Quote every cell; a leading = + - @ is neutralised so spreadsheets never run it as a formula.
    return '"' + (/^[=+\-@]/.test(s) ? "'" + s : s).replace(/"/g, '""') + '"';
  };
  const csv = ['email,confirmed_at_utc,source', ...rows.map(r => [r.email, r.confirmed_at, r.source].map(cell).join(','))].join('\r\n');
  logAudit(req.session.admin.id, 'exported_newsletter_list', 'newsletter', null, `${rows.length} subscribers`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="cultured-africa-newsletter-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('\uFEFF' + csv);
});

router.post('/customers/:id/suspend', (req, res) => {
  const customer = getCustomer(req.params.id);
  if (!customer) return res.redirect('/admin/customers?msg=not-found');
  const reason = String(req.body.reason || '').trim().slice(0, REASON_MAX_LENGTH) || null;

  if (customer.status !== 'suspended') {
    // Bumping session_version also ends every session the customer already has open.
    db.prepare(`
      UPDATE users SET status = 'suspended', suspended_at = datetime('now'), suspension_reason = ?,
             session_version = session_version + 1
      WHERE user_id = ?
    `).run(reason, customer.user_id);
    logAudit(req.session.admin.id, 'suspended_customer', 'user', customer.user_id, reason);
    logActivity('Customer suspended', customer.full_name, adminActor(req.session.admin));
  }
  res.redirect(`/admin/customers?msg=suspended${req.body.returnQuery ? '&' + String(req.body.returnQuery).replace(/[^a-z0-9=&%+._-]/gi, '') : ''}`);
});

router.post('/customers/:id/reactivate', (req, res) => {
  const customer = getCustomer(req.params.id);
  if (!customer) return res.redirect('/admin/customers?msg=not-found');

  if (customer.status === 'suspended') {
    db.prepare("UPDATE users SET status = 'active', suspended_at = NULL, suspension_reason = NULL WHERE user_id = ?")
      .run(customer.user_id);
    logAudit(req.session.admin.id, 'reactivated_customer', 'user', customer.user_id, null);
    logActivity('Customer reactivated', customer.full_name, adminActor(req.session.admin));
    notify(customer.user_id, 'system', 'Your Cultured Africa account has been reactivated. Welcome back!');
  }
  res.redirect(`/admin/customers?msg=reactivated${req.body.returnQuery ? '&' + String(req.body.returnQuery).replace(/[^a-z0-9=&%+._-]/gi, '') : ''}`);
});

// ------------------------------------------------------------------- Cultures

const REGION_MAX_LENGTH = 80;
const DESCRIPTION_MAX_LENGTH = 300;

function listCulturesWithCounts() {
  return db.prepare(`
    SELECT cu.culture_id, cu.name, cu.region, cu.description,
           (SELECT COUNT(*) FROM content c WHERE c.culture_id = cu.culture_id) AS films
    FROM cultures cu ORDER BY cu.name
  `).all().map(r => ({ id: r.culture_id, name: r.name, region: r.region || '', description: r.description || '', films: r.films }));
}

function renderCultures(res, { error = null, message = null, form = null, editingId = null, status = 200 } = {}) {
  res.status(status).render('admin-cultures', { cultures: listCulturesWithCounts(), error, message, form, editingId });
}

// Returns { values } or { error }. excludeId skips the culture being edited in the
// duplicate-name check, so saving it unchanged isn't flagged as a duplicate of itself.
function readCultureForm(body, excludeId) {
  const checked = validateCultureName(body.name);
  if (checked.error) return { error: checked.error };
  const region = String(body.region || '').trim().replace(/\s+/g, ' ');
  const description = String(body.description || '').trim();
  if (region.length > REGION_MAX_LENGTH) return { error: `Region must be ${REGION_MAX_LENGTH} characters or fewer.` };
  if (description.length > DESCRIPTION_MAX_LENGTH) return { error: `Description must be ${DESCRIPTION_MAX_LENGTH} characters or fewer.` };

  const duplicate = db.prepare('SELECT culture_id FROM cultures WHERE lower(name) = lower(?) AND culture_id != ?')
    .get(checked.name, excludeId || 0);
  if (duplicate) return { error: `A culture called "${checked.name}" already exists.` };
  return { values: { name: checked.name, region, description } };
}

router.get('/cultures', (req, res) => {
  renderCultures(res, { message: CULTURE_MESSAGES[req.query.msg] || null });
});

router.post('/cultures', (req, res) => {
  const result = readCultureForm(req.body);
  if (result.error) return renderCultures(res, { error: result.error, form: req.body, status: 400 });
  const { name, region, description } = result.values;
  const id = db.prepare("INSERT INTO cultures (name, region, description, banner_image_url) VALUES (?, ?, ?, '')")
    .run(name, region, description).lastInsertRowid;
  logAudit(req.session.admin.id, 'added_culture', 'culture', id, name);
  logActivity('Culture added', name, adminActor(req.session.admin));
  res.redirect('/admin/cultures?msg=added');
});

router.post('/cultures/:id/edit', (req, res) => {
  const culture = db.prepare('SELECT * FROM cultures WHERE culture_id = ?').get(req.params.id);
  if (!culture) return res.redirect('/admin/cultures?msg=not-found');
  const result = readCultureForm(req.body, culture.culture_id);
  if (result.error) {
    return renderCultures(res, { error: result.error, form: req.body, editingId: culture.culture_id, status: 400 });
  }
  const { name, region, description } = result.values;
  db.prepare('UPDATE cultures SET name = ?, region = ?, description = ? WHERE culture_id = ?')
    .run(name, region, description, culture.culture_id);
  const renamed = name !== culture.name ? `${culture.name} → ${name}` : name;
  logAudit(req.session.admin.id, 'updated_culture', 'culture', culture.culture_id, renamed);
  logActivity('Culture updated', renamed, adminActor(req.session.admin));
  res.redirect('/admin/cultures?msg=updated');
});

router.post('/cultures/:id/delete', (req, res) => {
  const culture = db.prepare('SELECT * FROM cultures WHERE culture_id = ?').get(req.params.id);
  if (!culture) return res.redirect('/admin/cultures?msg=not-found');
  const films = db.prepare('SELECT COUNT(*) AS n FROM content WHERE culture_id = ?').get(culture.culture_id).n;
  if (films > 0) {
    return renderCultures(res, {
      error: `"${culture.name}" can't be removed because ${films} film${films === 1 ? ' uses' : 's use'} it. Move ${films === 1 ? 'that film' : 'those films'} to another culture first (Manage Films → Edit).`,
      status: 400
    });
  }
  db.prepare('DELETE FROM cultures WHERE culture_id = ?').run(culture.culture_id);
  logAudit(req.session.admin.id, 'removed_culture', 'culture', culture.culture_id, culture.name);
  logActivity('Culture removed', culture.name, adminActor(req.session.admin));
  res.redirect('/admin/cultures?msg=removed');
});

module.exports = router;
