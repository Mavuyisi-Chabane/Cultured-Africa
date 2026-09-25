const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { db, logActivity, notify, logAudit, ensureShadowUserForAdmin } = require('../db');
const { requireAdmin, requireSuperAdmin } = require('../middleware/auth');
const handleUploads = require('../middleware/upload');
const { startOfWeek, endOfWeek, toSqlDateTime, formatWeekLabel } = require('../utils/dates');
const mockReports = require('../data/mockReports');
const { buildScreenshotPdf } = require('../utils/screenshotPdf');
const { containsProfanity } = require('../utils/profanityFilter');
const { nextAdminId } = require('../utils/adminId');
const { generateInviteCode, hashInviteCode, INVITE_TTL_MS, MAX_INVITE_ATTEMPTS } = require('../utils/adminInvites');
const { sendAdminInviteEmail } = require('../services/email');

const router = express.Router();

router.use(requireAdmin);

const CONTENT_SELECT = `
  SELECT c.*, cu.name AS culture_name,
    (SELECT AVG(rating) FROM feedback WHERE content_id = c.content_id AND status = 'published') AS avg_rating
  FROM content c
  JOIN cultures cu ON cu.culture_id = c.culture_id
`;

const FEEDBACK_PAGE_SIZE = 15;

function appendQueryParam(url, key, value) {
  return `${url}${url.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(value)}`;
}

function deleteUploadedFile(urlPath) {
  if (!urlPath || !urlPath.startsWith('/uploads/')) return;
  const filePath = path.join(handleUploads.UPLOAD_DIR, urlPath.slice('/uploads/'.length));
  fs.unlink(filePath, () => {});
}

function mapContent(row) {
  return {
    id: row.content_id,
    title: row.title,
    culture: row.culture_name,
    genre: row.content_type,
    price: row.price,
    rating: row.avg_rating ? Math.round(row.avg_rating * 10) / 10 : 0,
    videoUrl: row.file_url,
    thumbnailUrl: row.thumbnail_url,
    trailerUrl: row.trailer_url,
    description: row.description,
    isAvailable: Boolean(row.is_available),
    uploadedAt: new Date(row.upload_date)
  };
}

function getContent(id) {
  const row = db.prepare(`${CONTENT_SELECT} WHERE c.content_id = ?`).get(id);
  return row ? mapContent(row) : null;
}

function verifyOwnPassword(req, password) {
  const admin = db.prepare('SELECT password_hash FROM admins WHERE admin_id = ?').get(req.session.admin.id);
  return Boolean(admin && admin.password_hash && bcrypt.compareSync(password || '', admin.password_hash));
}

function getCultureId(name) {
  const row = db.prepare('SELECT culture_id FROM cultures WHERE name = ?').get(name);
  return row ? row.culture_id : db.prepare('SELECT culture_id FROM cultures ORDER BY culture_id LIMIT 1').get().culture_id;
}

router.get('/dashboard', (req, res) => {
  const totalRevenue = db.prepare("SELECT COALESCE(SUM(amount_paid), 0) AS total FROM purchases WHERE payment_status = 'completed'").get().total;
  const stats = {
    totalFilms: db.prepare('SELECT COUNT(*) AS n FROM content').get().n,
    totalUsers: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
    totalRevenue,
    totalReviews: db.prepare('SELECT COUNT(*) AS n FROM feedback').get().n
  };

  res.render('admin-dashboard', { stats });
});

router.get('/activity', (req, res) => {
  const recentActivity = db.prepare('SELECT type, entity, created_at FROM activity_log ORDER BY created_at DESC, id DESC LIMIT 200')
    .all()
    .map(a => ({ type: a.type, entity: a.entity, timestamp: new Date(a.created_at) }));

  res.render('admin-activity', { recentActivity });
});

router.get('/films', (req, res) => {
  const films = db.prepare(`${CONTENT_SELECT} ORDER BY c.upload_date DESC`).all().map(mapContent);
  res.render('admin-manage-films', { films, error: null });
});

router.post('/films/:id/delete', (req, res) => {
  const film = getContent(req.params.id);
  if (film) {
    db.prepare('DELETE FROM content WHERE content_id = ?').run(film.id);
    deleteUploadedFile(film.videoUrl);
    deleteUploadedFile(film.thumbnailUrl);
    deleteUploadedFile(film.trailerUrl);
    logActivity('Film removed', film.title);
  }
  res.redirect('/admin/films');
});

router.post('/films/:id/toggle-availability', (req, res) => {
  const film = getContent(req.params.id);
  if (film) {
    db.prepare('UPDATE content SET is_available = ? WHERE content_id = ?').run(film.isAvailable ? 0 : 1, film.id);
    logActivity(film.isAvailable ? 'Film archived' : 'Film restored', film.title);
  }
  res.redirect('/admin/films');
});

router.get('/films/:id/edit', (req, res) => {
  const film = getContent(req.params.id);
  if (!film) return res.status(404).send('Film not found.');
  const cultures = db.prepare('SELECT name FROM cultures ORDER BY name').all().map(r => r.name);
  res.render('admin-upload', { editing: film, cultures, error: null, success: false });
});

router.post('/films/:id/edit', handleUploads, (req, res) => {
  const film = getContent(req.params.id);
  if (!film) return res.status(404).send('Film not found.');

  const { title, description, culture, price, isFree } = req.body;
  const videoFile = req.files && req.files.videoFile && req.files.videoFile[0];
  const thumbnailFile = req.files && req.files.thumbnailFile && req.files.thumbnailFile[0];
  const trailerFile = req.files && req.files.trailerFile && req.files.trailerFile[0];

  if (!title || !description) {
    const cultures = db.prepare('SELECT name FROM cultures ORDER BY name').all().map(r => r.name);
    return res.render('admin-upload', { editing: { ...film, ...req.body }, cultures, error: 'Please fill in all required fields.', success: false });
  }

  let videoUrl = film.videoUrl;
  let thumbnailUrl = film.thumbnailUrl;
  let trailerUrl = film.trailerUrl;

  if (videoFile) {
    deleteUploadedFile(film.videoUrl);
    videoUrl = `/uploads/${videoFile.filename}`;
  }
  if (thumbnailFile) {
    deleteUploadedFile(film.thumbnailUrl);
    thumbnailUrl = `/uploads/${thumbnailFile.filename}`;
  }
  if (trailerFile) {
    deleteUploadedFile(film.trailerUrl);
    trailerUrl = `/uploads/${trailerFile.filename}`;
  }

  db.prepare(`
    UPDATE content SET title = ?, description = ?, culture_id = ?, price = ?, file_url = ?, thumbnail_url = ?, trailer_url = ?
    WHERE content_id = ?
  `).run(title, description, getCultureId(culture), isFree ? 0 : Number(price) || 0, videoUrl, thumbnailUrl, trailerUrl, film.id);
  logActivity('Film updated', title);

  res.redirect('/admin/films');
});

router.get('/upload', (req, res) => {
  const cultures = db.prepare('SELECT name FROM cultures ORDER BY name').all().map(r => r.name);
  res.render('admin-upload', { editing: null, cultures, error: null, success: req.query.success === '1' });
});

router.post('/upload', handleUploads, (req, res) => {
  const { title, description, culture, price, isFree } = req.body;
  const videoFile = req.files && req.files.videoFile && req.files.videoFile[0];
  const thumbnailFile = req.files && req.files.thumbnailFile && req.files.thumbnailFile[0];
  const trailerFile = req.files && req.files.trailerFile && req.files.trailerFile[0];

  if (!title || !description || !videoFile || !thumbnailFile) {
    if (videoFile) deleteUploadedFile(`/uploads/${videoFile.filename}`);
    if (thumbnailFile) deleteUploadedFile(`/uploads/${thumbnailFile.filename}`);
    if (trailerFile) deleteUploadedFile(`/uploads/${trailerFile.filename}`);
    const cultures = db.prepare('SELECT name FROM cultures ORDER BY name').all().map(r => r.name);
    return res.render('admin-upload', { editing: req.body, cultures, error: 'Please fill in all required fields, including a video file and a thumbnail image.', success: false });
  }

  db.prepare(`
    INSERT INTO content (culture_id, uploaded_by, title, description, content_type, price, file_url, thumbnail_url, trailer_url)
    VALUES (?, ?, ?, ?, 'Uncategorized', ?, ?, ?, ?)
  `).run(
    getCultureId(culture), ensureShadowUserForAdmin(req.session.admin), title, description, isFree ? 0 : Number(price) || 0,
    `/uploads/${videoFile.filename}`, `/uploads/${thumbnailFile.filename}`,
    trailerFile ? `/uploads/${trailerFile.filename}` : ''
  );
  logActivity('Film uploaded', title);

  res.redirect('/admin/upload?success=1');
});

router.get('/feedback', (req, res) => {
  const films = db.prepare('SELECT content_id, title FROM content ORDER BY title').all()
    .map(r => ({ id: r.content_id, title: r.title }));

  const statusCounts = { all: 0, published: 0, removed: 0 };
  db.prepare('SELECT status, COUNT(*) AS n FROM feedback GROUP BY status').all().forEach(r => {
    statusCounts[r.status] = r.n;
    statusCounts.all += r.n;
  });

  const filters = {
    film: req.query.film || '',
    rating: req.query.rating || '',
    status: req.query.status || '',
    flagged: req.query.flagged === '1'
  };

  let sql = `
    SELECT f.*, c.title AS film_title, u.full_name AS user_full_name
    FROM feedback f
    JOIN content c ON c.content_id = f.content_id
    JOIN users u ON u.user_id = f.user_id
    WHERE 1 = 1
  `;
  const params = [];
  if (filters.film) { sql += ' AND f.content_id = ?'; params.push(Number(filters.film)); }
  if (filters.rating) { sql += ' AND f.rating = ?'; params.push(Number(filters.rating)); }
  if (filters.status) { sql += ' AND f.status = ?'; params.push(filters.status); }
  sql += ' ORDER BY f.submitted_date DESC';

  let feedback = db.prepare(sql).all(...params).map(r => ({
    id: r.feedback_id,
    rating: r.rating,
    comment: r.comment,
    adminReply: r.admin_reply,
    status: r.status,
    removedBy: r.removed_by,
    removedAt: r.removed_at ? new Date(r.removed_at) : null,
    removalReason: r.removal_reason,
    createdAt: new Date(r.submitted_date),
    userId: r.user_id,
    contentId: r.content_id,
    film: { title: r.film_title },
    user: { fullName: r.user_full_name },
    flagged: containsProfanity(r.comment)
  }));

  // The profanity filter matches whole words in the comment text, which isn't
  // expressible as a plain SQL WHERE clause, so this filter is applied in JS
  // after the other (SQL-filterable) filters above.
  if (filters.flagged) {
    feedback = feedback.filter(r => r.flagged);
  }

  const total = feedback.length;
  const totalPages = Math.max(1, Math.ceil(total / FEEDBACK_PAGE_SIZE));
  const page = Math.min(Math.max(1, parseInt(req.query.page, 10) || 1), totalPages);
  const pageFeedback = feedback.slice((page - 1) * FEEDBACK_PAGE_SIZE, page * FEEDBACK_PAGE_SIZE);

  res.render('admin-feedback', {
    feedback: pageFeedback,
    films,
    filters,
    statusCounts,
    pagination: { page, totalPages, total, pageSize: FEEDBACK_PAGE_SIZE },
    toast: req.query.toast || null,
    toastCount: req.query.count || null
  });
});

router.post('/feedback/:id/reply', (req, res) => {
  const reply = (req.body.reply || '').trim();
  const returnTo = req.body.returnTo || '/admin/feedback';
  const review = db.prepare('SELECT * FROM feedback WHERE feedback_id = ?').get(req.params.id);

  // Removed comments are hidden from the public film page, so replying to one would
  // notify the customer about a reply attached to a comment nobody else can see.
  if (review && review.status === 'published') {
    db.prepare('UPDATE feedback SET admin_reply = ? WHERE feedback_id = ?').run(reply, review.feedback_id);
    if (reply) {
      const film = db.prepare('SELECT title FROM content WHERE content_id = ?').get(review.content_id);
      notify(review.user_id, 'admin_reply', `Cultured Africa replied to your review of "${film ? film.title : 'a film'}": ${reply}`);
    }
  }
  res.redirect(returnTo);
});

router.post('/feedback/:id/delete', (req, res) => {
  const returnTo = req.body.returnTo || '/admin/feedback';
  const review = db.prepare(`
    SELECT f.*, c.title AS film_title FROM feedback f
    JOIN content c ON c.content_id = f.content_id
    WHERE f.feedback_id = ?
  `).get(req.params.id);

  if (!review) return res.redirect(returnTo);

  const reason = (req.body.reason || '').trim() || null;
  db.prepare(`
    UPDATE feedback SET status = 'removed', removed_by = ?, removed_at = datetime('now'), removal_reason = ?
    WHERE feedback_id = ?
  `).run(req.session.admin.id, reason, review.feedback_id);

  logAudit(req.session.admin.id, 'removed_feedback', 'feedback', review.feedback_id, reason);
  logActivity('Feedback removed', review.film_title);

  res.redirect(appendQueryParam(returnTo, 'toast', 'removed'));
});

router.post('/feedback/:id/restore', (req, res) => {
  const returnTo = req.body.returnTo || '/admin/feedback';
  const review = db.prepare(`
    SELECT f.*, c.title AS film_title FROM feedback f
    JOIN content c ON c.content_id = f.content_id
    WHERE f.feedback_id = ?
  `).get(req.params.id);

  if (!review) return res.redirect(returnTo);

  db.prepare(`
    UPDATE feedback SET status = 'published', removed_by = NULL, removed_at = NULL, removal_reason = NULL
    WHERE feedback_id = ?
  `).run(review.feedback_id);

  logAudit(req.session.admin.id, 'restored_feedback', 'feedback', review.feedback_id, null);
  logActivity('Feedback restored', review.film_title);

  res.redirect(appendQueryParam(returnTo, 'toast', 'restored'));
});

router.post('/feedback/bulk-delete', (req, res) => {
  const returnTo = req.body.returnTo || '/admin/feedback';
  const idsRaw = req.body.ids;
  const ids = [...new Set((Array.isArray(idsRaw) ? idsRaw : idsRaw ? [idsRaw] : []).map(Number).filter(Number.isInteger))];

  if (ids.length === 0) {
    return res.redirect(appendQueryParam(returnTo, 'toast', 'bulk-empty'));
  }

  // High-impact action: re-verify the acting admin's own password before touching
  // anything. Wrong password rejects the whole batch — nothing is deleted.
  const admin = db.prepare('SELECT password_hash FROM admins WHERE admin_id = ?').get(req.session.admin.id);
  if (!admin || !admin.password_hash || !bcrypt.compareSync(req.body.password || '', admin.password_hash)) {
    return res.redirect(appendQueryParam(returnTo, 'toast', 'bulk-auth-failed'));
  }

  const placeholders = ids.map(() => '?').join(',');
  const targets = db.prepare(`
    SELECT f.feedback_id, c.title AS film_title FROM feedback f
    JOIN content c ON c.content_id = f.content_id
    WHERE f.feedback_id IN (${placeholders}) AND f.status = 'published'
  `).all(...ids);

  const removeStmt = db.prepare(`
    UPDATE feedback SET status = 'removed', removed_by = ?, removed_at = datetime('now'), removal_reason = 'Bulk removal'
    WHERE feedback_id = ?
  `);
  targets.forEach(t => removeStmt.run(req.session.admin.id, t.feedback_id));

  logAudit(
    req.session.admin.id, 'bulk_removed_feedback', 'feedback',
    targets.map(t => t.feedback_id).join(','),
    `Removed ${targets.length} comment(s)`
  );
  if (targets.length > 0) {
    logActivity('Bulk feedback removal', `${targets.length} comment(s) removed`);
  }

  res.redirect(appendQueryParam(appendQueryParam(returnTo, 'toast', 'bulk-removed'), 'count', targets.length));
});

router.get('/manage-admins', requireSuperAdmin, (req, res) => {
  const admins = db.prepare('SELECT * FROM admins ORDER BY admin_id ASC').all().map(a => {
    const invite = !a.password_hash
      ? db.prepare('SELECT * FROM admin_invites WHERE lower(email) = lower(?) ORDER BY id DESC LIMIT 1').get(a.email)
      : null;
    return {
      id: a.admin_id,
      name: a.name,
      email: a.email,
      role: a.role,
      status: a.status,
      pending: !a.password_hash,
      isSelf: a.admin_id === req.session.admin.id,
      invite: invite ? { id: invite.id, status: invite.status, expiresAt: new Date(invite.expires_at) } : null,
      createdAt: new Date(a.created_at)
    };
  });

  res.render('admin-manage-admins', {
    admins,
    toast: req.query.toast || null,
    error: req.query.error || null
  });
});

router.post('/manage-admins/invite', requireSuperAdmin, async (req, res) => {
  const name = (req.body.name || '').trim();
  const email = (req.body.email || '').trim();

  if (!name || !email) {
    return res.redirect(appendQueryParam('/admin/manage-admins', 'error', 'Name and email are required.'));
  }
  if (db.prepare('SELECT admin_id FROM admins WHERE lower(email) = lower(?)').get(email)) {
    return res.redirect(appendQueryParam('/admin/manage-admins', 'error', 'An admin with that email already exists.'));
  }
  if (db.prepare("SELECT id FROM admin_invites WHERE lower(email) = lower(?) AND status = 'pending'").get(email)) {
    return res.redirect(appendQueryParam('/admin/manage-admins', 'error', 'There is already a pending invite for that email.'));
  }

  // The admin_id is reserved immediately (password_hash stays NULL) so it's stable
  // from the moment the invite is sent, even before the invitee verifies anything.
  const adminId = nextAdminId(db);
  db.prepare(`
    INSERT INTO admins (admin_id, name, email, password_hash, role, status, invited_by, verified_at, created_at)
    VALUES (?, ?, ?, NULL, 'admin', 'active', ?, NULL, datetime('now'))
  `).run(adminId, name, email, req.session.admin.id);

  const code = generateInviteCode();
  const expiresAt = toSqlDateTime(new Date(Date.now() + INVITE_TTL_MS));
  db.prepare(`
    INSERT INTO admin_invites (name, email, code_hash, expires_at, invited_by, status, attempts)
    VALUES (?, ?, ?, ?, ?, 'pending', 0)
  `).run(name, email, hashInviteCode(code), expiresAt, req.session.admin.id);

  try {
    await sendAdminInviteEmail({ name, email }, code);
  } catch (err) {
    console.error('Failed to send admin invite email:', err.message);
  }

  logAudit(req.session.admin.id, 'invited_admin', 'admin', adminId, email);
  res.redirect(appendQueryParam('/admin/manage-admins', 'toast', 'invited'));
});

router.post('/manage-admins/invites/:inviteId/resend', requireSuperAdmin, async (req, res) => {
  const invite = db.prepare('SELECT * FROM admin_invites WHERE id = ?').get(req.params.inviteId);
  if (!invite) {
    return res.redirect(appendQueryParam('/admin/manage-admins', 'error', 'Invite not found.'));
  }

  const admin = db.prepare('SELECT * FROM admins WHERE lower(email) = lower(?)').get(invite.email);
  if (!admin || admin.password_hash) {
    return res.redirect(appendQueryParam('/admin/manage-admins', 'error', 'This invite has already been used.'));
  }

  db.prepare("UPDATE admin_invites SET status = 'expired' WHERE lower(email) = lower(?) AND status = 'pending'").run(invite.email);

  const code = generateInviteCode();
  const expiresAt = toSqlDateTime(new Date(Date.now() + INVITE_TTL_MS));
  db.prepare(`
    INSERT INTO admin_invites (name, email, code_hash, expires_at, invited_by, status, attempts)
    VALUES (?, ?, ?, ?, ?, 'pending', 0)
  `).run(invite.name, invite.email, hashInviteCode(code), expiresAt, req.session.admin.id);

  try {
    await sendAdminInviteEmail({ name: invite.name, email: invite.email }, code);
  } catch (err) {
    console.error('Failed to resend admin invite email:', err.message);
  }

  logAudit(req.session.admin.id, 'resent_admin_invite', 'admin', admin.admin_id, invite.email);
  res.redirect(appendQueryParam('/admin/manage-admins', 'toast', 'invite-resent'));
});

router.post('/manage-admins/:adminId/cancel-invite', requireSuperAdmin, (req, res) => {
  const targetId = req.params.adminId;
  const target = db.prepare('SELECT * FROM admins WHERE admin_id = ?').get(targetId);

  if (!target) {
    return res.redirect(appendQueryParam('/admin/manage-admins', 'error', 'Admin not found.'));
  }
  // Only a not-yet-verified invite can be unsent this way — once a password is set
  // they're a real admin, and removing their access goes through Deactivate instead
  // (which, unlike this, keeps the row and re-auth-gates the action).
  if (target.password_hash) {
    return res.redirect(appendQueryParam('/admin/manage-admins', 'error', 'This admin has already verified their invite — use Deactivate instead.'));
  }

  // The admin_id was only ever a reservation for someone who never completed
  // onboarding, so both the invite and the placeholder admin row are removed
  // outright rather than soft-deleted — there's no real admin activity to preserve.
  db.prepare('DELETE FROM admin_invites WHERE lower(email) = lower(?)').run(target.email);
  db.prepare('DELETE FROM admins WHERE admin_id = ?').run(targetId);

  logAudit(req.session.admin.id, 'cancelled_invite', 'admin', targetId, target.email);
  res.redirect(appendQueryParam('/admin/manage-admins', 'toast', 'invite-cancelled'));
});

router.post('/manage-admins/:adminId/deactivate', requireSuperAdmin, (req, res) => {
  const targetId = req.params.adminId;

  if (targetId === req.session.admin.id) {
    return res.redirect(appendQueryParam('/admin/manage-admins', 'error', 'You cannot deactivate your own account.'));
  }
  if (!verifyOwnPassword(req, req.body.password)) {
    return res.redirect(appendQueryParam('/admin/manage-admins', 'error', 'Incorrect password. No changes were made.'));
  }

  const target = db.prepare('SELECT * FROM admins WHERE admin_id = ?').get(targetId);
  if (!target) {
    return res.redirect(appendQueryParam('/admin/manage-admins', 'error', 'Admin not found.'));
  }
  if (target.role === 'super_admin') {
    const activeSuperAdmins = db.prepare("SELECT COUNT(*) AS n FROM admins WHERE role = 'super_admin' AND status = 'active'").get().n;
    if (activeSuperAdmins <= 1) {
      return res.redirect(appendQueryParam('/admin/manage-admins', 'error', 'Cannot deactivate the last active super admin.'));
    }
  }

  // Sessions aren't stored server-side by admin_id, so there's nothing to revoke by
  // reference — but server.js re-checks status against the DB on every request, so
  // this takes effect on the deactivated admin's very next request either way.
  db.prepare("UPDATE admins SET status = 'inactive' WHERE admin_id = ?").run(targetId);
  logAudit(req.session.admin.id, 'deactivated_admin', 'admin', targetId, null);
  res.redirect(appendQueryParam('/admin/manage-admins', 'toast', 'deactivated'));
});

router.post('/manage-admins/:adminId/reactivate', requireSuperAdmin, (req, res) => {
  const targetId = req.params.adminId;

  if (!verifyOwnPassword(req, req.body.password)) {
    return res.redirect(appendQueryParam('/admin/manage-admins', 'error', 'Incorrect password. No changes were made.'));
  }
  const target = db.prepare('SELECT * FROM admins WHERE admin_id = ?').get(targetId);
  if (!target) {
    return res.redirect(appendQueryParam('/admin/manage-admins', 'error', 'Admin not found.'));
  }

  db.prepare("UPDATE admins SET status = 'active' WHERE admin_id = ?").run(targetId);
  logAudit(req.session.admin.id, 'reactivated_admin', 'admin', targetId, null);
  res.redirect(appendQueryParam('/admin/manage-admins', 'toast', 'reactivated'));
});

router.post('/manage-admins/:adminId/role', requireSuperAdmin, (req, res) => {
  const targetId = req.params.adminId;
  const newRole = req.body.role === 'super_admin' ? 'super_admin' : 'admin';

  if (targetId === req.session.admin.id) {
    return res.redirect(appendQueryParam('/admin/manage-admins', 'error', 'You cannot change your own role here.'));
  }
  if (!verifyOwnPassword(req, req.body.password)) {
    return res.redirect(appendQueryParam('/admin/manage-admins', 'error', 'Incorrect password. No changes were made.'));
  }

  const target = db.prepare('SELECT * FROM admins WHERE admin_id = ?').get(targetId);
  if (!target) {
    return res.redirect(appendQueryParam('/admin/manage-admins', 'error', 'Admin not found.'));
  }
  if (target.role === 'super_admin' && newRole === 'admin') {
    const activeSuperAdmins = db.prepare("SELECT COUNT(*) AS n FROM admins WHERE role = 'super_admin' AND status = 'active'").get().n;
    if (activeSuperAdmins <= 1) {
      return res.redirect(appendQueryParam('/admin/manage-admins', 'error', 'Cannot demote the last active super admin.'));
    }
  }

  db.prepare('UPDATE admins SET role = ? WHERE admin_id = ?').run(newRole, targetId);
  logAudit(req.session.admin.id, 'changed_admin_role', 'admin', targetId, `role -> ${newRole}`);
  res.redirect(appendQueryParam('/admin/manage-admins', 'toast', 'role-updated'));
});

// Reports below use a fixed, hand-authored sample dataset (webapp/data/mockReports.js)
// rather than live queries, so the numbers stay presentable regardless of how sparse
// real activity in the dev database is. All figures cross-check against each other —
// see the comment at the top of that file for how consistency is enforced.
router.get('/reports', (req, res) => {
  res.render('admin-reports', {
    revenueReport: mockReports.buildRevenueReport(),
    contentReport: mockReports.buildContentReport()
  });
});

router.get('/analytics', (req, res) => {
  res.render('admin-analytics', mockReports.buildAnalyticsReport());
});

router.get('/engagement', (req, res) => {
  res.render('admin-engagement', mockReports.buildEngagementReport());
});

router.get('/reports/pdf', async (req, res) => {
  try {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const pdfBuffer = await buildScreenshotPdf({
      baseUrl,
      cookieHeader: req.headers.cookie,
      paths: ['/admin/reports', '/admin/analytics', '/admin/engagement']
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="cultured-africa-reports.pdf"');
    res.send(pdfBuffer);
  } catch (err) {
    console.error('PDF export failed:', err);
    res.status(500).send('Could not generate the PDF export. ' + err.message);
  }
});

module.exports = router;
