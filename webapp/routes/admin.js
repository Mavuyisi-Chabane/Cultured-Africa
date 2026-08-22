const express = require('express');
const fs = require('fs');
const path = require('path');
const { db, logActivity, notify } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const handleUploads = require('../middleware/upload');
const { startOfWeek, endOfWeek, toSqlDateTime, formatWeekLabel } = require('../utils/dates');

const router = express.Router();

router.use(requireAdmin);

const CONTENT_SELECT = `
  SELECT c.*, cu.name AS culture_name,
    (SELECT AVG(rating) FROM feedback WHERE content_id = c.content_id) AS avg_rating
  FROM content c
  JOIN cultures cu ON cu.culture_id = c.culture_id
`;

function deleteUploadedFile(urlPath) {
  if (!urlPath || !urlPath.startsWith('/uploads/')) return;
  const filePath = path.join(__dirname, '..', 'public', urlPath);
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
  const recentActivity = db.prepare('SELECT type, entity, created_at FROM activity_log ORDER BY created_at DESC, id DESC LIMIT 8')
    .all()
    .map(a => ({ type: a.type, entity: a.entity, timestamp: new Date(a.created_at) }));

  res.render('admin-dashboard', { stats, recentActivity });
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
  res.render('admin-upload', { editing: film, cultures, error: null });
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
    return res.render('admin-upload', { editing: { ...film, ...req.body }, cultures, error: 'Please fill in all required fields.' });
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
  res.render('admin-upload', { editing: null, cultures, error: null });
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
    return res.render('admin-upload', { editing: req.body, cultures, error: 'Please fill in all required fields, including a video file and a thumbnail image.' });
  }

  db.prepare(`
    INSERT INTO content (culture_id, uploaded_by, title, description, content_type, price, file_url, thumbnail_url, trailer_url)
    VALUES (?, ?, ?, ?, 'Uncategorized', ?, ?, ?, ?)
  `).run(
    getCultureId(culture), req.session.user.id, title, description, isFree ? 0 : Number(price) || 0,
    `/uploads/${videoFile.filename}`, `/uploads/${thumbnailFile.filename}`,
    trailerFile ? `/uploads/${trailerFile.filename}` : ''
  );
  logActivity('Film uploaded', title);

  res.redirect('/admin/upload');
});

router.get('/feedback', (req, res) => {
  const feedback = db.prepare(`
    SELECT f.*, c.title AS film_title, u.full_name AS user_full_name
    FROM feedback f
    JOIN content c ON c.content_id = f.content_id
    JOIN users u ON u.user_id = f.user_id
    ORDER BY f.submitted_date DESC
  `).all().map(r => ({
    id: r.feedback_id,
    rating: r.rating,
    comment: r.comment,
    adminReply: r.admin_reply,
    createdAt: new Date(r.submitted_date),
    userId: r.user_id,
    film: { title: r.film_title },
    user: { fullName: r.user_full_name }
  }));

  res.render('admin-feedback', { feedback });
});

router.post('/feedback/:id/reply', (req, res) => {
  const reply = (req.body.reply || '').trim();
  const review = db.prepare('SELECT * FROM feedback WHERE feedback_id = ?').get(req.params.id);
  if (review) {
    db.prepare('UPDATE feedback SET admin_reply = ? WHERE feedback_id = ?').run(reply, review.feedback_id);
    if (reply) {
      const film = db.prepare('SELECT title FROM content WHERE content_id = ?').get(review.content_id);
      notify(review.user_id, 'admin_reply', `Cultured Africa replied to your review of "${film ? film.title : 'a film'}": ${reply}`);
    }
  }
  res.redirect('/admin/feedback');
});

router.get('/reports', (req, res) => {
  const now = new Date();
  const weekStart = startOfWeek(now);
  const weekEnd = endOfWeek(now);
  const weekStartSql = toSqlDateTime(weekStart);
  const weekEndSql = toSqlDateTime(weekEnd);
  const weekLabel = formatWeekLabel(weekStart, weekEnd);

  const films = db.prepare(`${CONTENT_SELECT} ORDER BY c.title`).all().map(mapContent);

  // ---- Weekly Revenue Report ----
  const revenueByFilm = films.map(film => {
    const row = db.prepare(`
      SELECT COUNT(*) AS units, COALESCE(SUM(amount_paid), 0) AS revenue
      FROM purchases WHERE content_id = ? AND payment_status = 'completed' AND purchase_date >= ? AND purchase_date < ?
    `).get(film.id, weekStartSql, weekEndSql);
    return { title: film.title, culture: film.culture, price: film.price, units: row.units, revenue: row.revenue };
  }).sort((a, b) => b.revenue - a.revenue);

  const revenueTotals = db.prepare(`
    SELECT COUNT(*) AS units, COALESCE(SUM(amount_paid), 0) AS revenue
    FROM purchases WHERE payment_status = 'completed' AND purchase_date >= ? AND purchase_date < ?
  `).get(weekStartSql, weekEndSql);

  const topPerformer = revenueByFilm.find(f => f.revenue > 0) || null;
  const freeFilmWithViews = films
    .filter(f => f.price === 0)
    .map(f => ({
      title: f.title,
      views: db.prepare('SELECT COUNT(*) AS n FROM watch_history WHERE content_id = ? AND watch_date >= ? AND watch_date < ?')
        .get(f.id, weekStartSql, weekEndSql).n
    }))
    .sort((a, b) => b.views - a.views)[0] || null;

  const revenueReport = {
    weekLabel,
    totalRevenue: revenueTotals.revenue,
    totalUnitsSold: revenueTotals.units,
    activeFilms: films.filter(f => f.isAvailable).length,
    byFilm: revenueByFilm,
    insights: { topPerformer, freeFilmWithViews }
  };

  // ---- Content Performance Report ----
  const perFilmPerformance = films.map(film => {
    const viewRow = db.prepare(`
      SELECT COUNT(*) AS views, COALESCE(SUM(completed), 0) AS completedCount
      FROM watch_history WHERE content_id = ? AND watch_date >= ? AND watch_date < ?
    `).get(film.id, weekStartSql, weekEndSql);
    const reviewRow = db.prepare(`
      SELECT COUNT(*) AS n, AVG(rating) AS avg
      FROM feedback WHERE content_id = ? AND submitted_date >= ? AND submitted_date < ?
    `).get(film.id, weekStartSql, weekEndSql);
    return {
      title: film.title,
      culture: film.culture,
      views: viewRow.views,
      completionRate: viewRow.views ? Math.round((viewRow.completedCount / viewRow.views) * 100) : 0,
      reviewCount: reviewRow.n,
      avgRating: reviewRow.avg ? Math.round(reviewRow.avg * 10) / 10 : null
    };
  }).sort((a, b) => b.views - a.views);

  const viewTotals = db.prepare(`
    SELECT COUNT(*) AS views, COALESCE(SUM(completed), 0) AS completedCount
    FROM watch_history WHERE watch_date >= ? AND watch_date < ?
  `).get(weekStartSql, weekEndSql);

  const reviewTotals = db.prepare(`
    SELECT COUNT(*) AS n, AVG(rating) AS avg
    FROM feedback WHERE submitted_date >= ? AND submitted_date < ?
  `).get(weekStartSql, weekEndSql);

  const fourWeekTrend = [];
  for (let weekAgo = 3; weekAgo >= 0; weekAgo--) {
    const ws = new Date(weekStart.getTime() - weekAgo * 7 * 24 * 60 * 60 * 1000);
    const we = new Date(ws.getTime() + 7 * 24 * 60 * 60 * 1000);
    const count = db.prepare('SELECT COUNT(*) AS n FROM watch_history WHERE watch_date >= ? AND watch_date < ?')
      .get(toSqlDateTime(ws), toSqlDateTime(we)).n;
    fourWeekTrend.push({ label: `Week ${4 - weekAgo}`, views: count });
  }

  const mostViewed = perFilmPerformance.find(f => f.views > 0) || null;
  const highestRated = [...perFilmPerformance]
    .filter(f => f.avgRating !== null)
    .sort((a, b) => b.avgRating - a.avgRating)[0] || null;
  const bestCompletion = [...perFilmPerformance]
    .filter(f => f.views > 0)
    .sort((a, b) => b.completionRate - a.completionRate)[0] || null;
  const cultureViewMap = {};
  perFilmPerformance.forEach(f => {
    cultureViewMap[f.culture] = (cultureViewMap[f.culture] || 0) + f.views;
  });
  const topCulture = Object.entries(cultureViewMap).sort((a, b) => b[1] - a[1])[0];

  const contentReport = {
    weekLabel,
    totalViews: viewTotals.views,
    avgCompletion: viewTotals.views ? Math.round((viewTotals.completedCount / viewTotals.views) * 100) : 0,
    avgRating: reviewTotals.avg ? Math.round(reviewTotals.avg * 10) / 10 : null,
    totalReviews: reviewTotals.n,
    byFilm: perFilmPerformance,
    trend: fourWeekTrend,
    insights: { mostViewed, highestRated, bestCompletion, topCulture: topCulture ? topCulture[0] : null }
  };

  res.render('admin-reports', { revenueReport, contentReport });
});

module.exports = router;
