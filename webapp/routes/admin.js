const express = require('express');
const fs = require('fs');
const path = require('path');
const { db, logActivity } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const handleUploads = require('../middleware/upload');
const { startOfWeek, endOfWeek, toSqlDateTime, formatWeekLabel } = require('../utils/dates');

const router = express.Router();

router.use(requireAdmin);

function deleteUploadedFile(urlPath) {
  if (!urlPath || !urlPath.startsWith('/uploads/')) return;
  const filePath = path.join(__dirname, '..', 'public', urlPath);
  fs.unlink(filePath, () => {});
}

function mapFilm(row) {
  return {
    id: row.id,
    title: row.title,
    culture: row.culture,
    genre: row.genre,
    price: row.price,
    rating: row.rating,
    videoUrl: row.video_url,
    thumbnailUrl: row.thumbnail_url,
    trailerUrl: row.trailer_url,
    description: row.description,
    uploadedAt: new Date(row.uploaded_at)
  };
}

function getFilm(id) {
  const row = db.prepare('SELECT * FROM films WHERE id = ?').get(id);
  return row ? mapFilm(row) : null;
}

router.get('/dashboard', (req, res) => {
  const totalRevenue = db.prepare('SELECT COALESCE(SUM(price), 0) AS total FROM purchases').get().total;
  const stats = {
    totalFilms: db.prepare('SELECT COUNT(*) AS n FROM films').get().n,
    totalUsers: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
    totalRevenue,
    totalReviews: db.prepare('SELECT COUNT(*) AS n FROM reviews').get().n
  };
  const recentActivity = db.prepare('SELECT type, entity, created_at FROM activity_log ORDER BY created_at DESC, id DESC LIMIT 8')
    .all()
    .map(a => ({ type: a.type, entity: a.entity, timestamp: new Date(a.created_at) }));

  res.render('admin-dashboard', { stats, recentActivity });
});

router.get('/films', (req, res) => {
  const films = db.prepare('SELECT * FROM films ORDER BY uploaded_at DESC').all().map(mapFilm);
  res.render('admin-manage-films', { films, error: null });
});

router.post('/films/:id/delete', (req, res) => {
  const film = getFilm(req.params.id);
  if (film) {
    db.prepare('DELETE FROM films WHERE id = ?').run(film.id);
    deleteUploadedFile(film.videoUrl);
    deleteUploadedFile(film.thumbnailUrl);
    deleteUploadedFile(film.trailerUrl);
    logActivity('Film removed', film.title);
  }
  res.redirect('/admin/films');
});

router.get('/films/:id/edit', (req, res) => {
  const film = getFilm(req.params.id);
  if (!film) return res.status(404).send('Film not found.');
  res.render('admin-upload', { editing: film, error: null });
});

router.post('/films/:id/edit', handleUploads, (req, res) => {
  const film = getFilm(req.params.id);
  if (!film) return res.status(404).send('Film not found.');

  const { title, description, culture, price, isFree } = req.body;
  const videoFile = req.files && req.files.videoFile && req.files.videoFile[0];
  const thumbnailFile = req.files && req.files.thumbnailFile && req.files.thumbnailFile[0];
  const trailerFile = req.files && req.files.trailerFile && req.files.trailerFile[0];

  if (!title || !description) {
    return res.render('admin-upload', { editing: { ...film, ...req.body }, error: 'Please fill in all required fields.' });
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
    UPDATE films SET title = ?, description = ?, culture = ?, price = ?, video_url = ?, thumbnail_url = ?, trailer_url = ?
    WHERE id = ?
  `).run(title, description, culture, isFree ? 0 : Number(price) || 0, videoUrl, thumbnailUrl, trailerUrl, film.id);
  logActivity('Film updated', title);

  res.redirect('/admin/films');
});

router.get('/upload', (req, res) => {
  res.render('admin-upload', { editing: null, error: null });
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
    return res.render('admin-upload', { editing: req.body, error: 'Please fill in all required fields, including a video file and a thumbnail image.' });
  }

  db.prepare(`
    INSERT INTO films (title, culture, genre, price, rating, video_url, thumbnail_url, trailer_url, description)
    VALUES (?, ?, 'Uncategorized', ?, 0, ?, ?, ?, ?)
  `).run(
    title, culture, isFree ? 0 : Number(price) || 0,
    `/uploads/${videoFile.filename}`, `/uploads/${thumbnailFile.filename}`,
    trailerFile ? `/uploads/${trailerFile.filename}` : '', description
  );
  logActivity('Film uploaded', title);

  res.redirect('/admin/upload');
});

router.get('/feedback', (req, res) => {
  const feedback = db.prepare(`
    SELECT r.*, f.title AS film_title, u.full_name AS user_full_name
    FROM reviews r
    JOIN films f ON f.id = r.film_id
    JOIN users u ON u.id = r.user_id
    ORDER BY r.created_at DESC
  `).all().map(r => ({
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    adminReply: r.admin_reply,
    createdAt: new Date(r.created_at),
    film: { title: r.film_title },
    user: { fullName: r.user_full_name }
  }));

  res.render('admin-feedback', { feedback });
});

router.post('/feedback/:id/reply', (req, res) => {
  db.prepare('UPDATE reviews SET admin_reply = ? WHERE id = ?').run((req.body.reply || '').trim(), req.params.id);
  res.redirect('/admin/feedback');
});

router.get('/reports', (req, res) => {
  const now = new Date();
  const weekStart = startOfWeek(now);
  const weekEnd = endOfWeek(now);
  const weekStartSql = toSqlDateTime(weekStart);
  const weekEndSql = toSqlDateTime(weekEnd);
  const weekLabel = formatWeekLabel(weekStart, weekEnd);

  const films = db.prepare('SELECT * FROM films ORDER BY title').all().map(mapFilm);

  // ---- Weekly Revenue Report ----
  const revenueByFilm = films.map(film => {
    const row = db.prepare(`
      SELECT COUNT(*) AS units, COALESCE(SUM(price), 0) AS revenue
      FROM purchases WHERE film_id = ? AND purchased_at >= ? AND purchased_at < ?
    `).get(film.id, weekStartSql, weekEndSql);
    return { title: film.title, culture: film.culture, price: film.price, units: row.units, revenue: row.revenue };
  }).sort((a, b) => b.revenue - a.revenue);

  const revenueTotals = db.prepare(`
    SELECT COUNT(*) AS units, COALESCE(SUM(price), 0) AS revenue
    FROM purchases WHERE purchased_at >= ? AND purchased_at < ?
  `).get(weekStartSql, weekEndSql);

  const topPerformer = revenueByFilm.find(f => f.revenue > 0) || null;
  const freeFilmWithViews = films
    .filter(f => f.price === 0)
    .map(f => ({
      title: f.title,
      views: db.prepare('SELECT COUNT(*) AS n FROM film_views WHERE film_id = ? AND viewed_at >= ? AND viewed_at < ?')
        .get(f.id, weekStartSql, weekEndSql).n
    }))
    .sort((a, b) => b.views - a.views)[0] || null;

  const revenueReport = {
    weekLabel,
    totalRevenue: revenueTotals.revenue,
    totalUnitsSold: revenueTotals.units,
    activeFilms: films.length,
    byFilm: revenueByFilm,
    insights: {
      topPerformer,
      freeFilmWithViews
    }
  };

  // ---- Content Performance Report ----
  const perFilmPerformance = films.map(film => {
    const viewRow = db.prepare(`
      SELECT COUNT(*) AS views, AVG(completion_pct) AS avgCompletion
      FROM film_views WHERE film_id = ? AND viewed_at >= ? AND viewed_at < ?
    `).get(film.id, weekStartSql, weekEndSql);
    const reviewRow = db.prepare(`
      SELECT COUNT(*) AS n, AVG(rating) AS avg
      FROM reviews WHERE film_id = ? AND created_at >= ? AND created_at < ?
    `).get(film.id, weekStartSql, weekEndSql);
    return {
      title: film.title,
      culture: film.culture,
      views: viewRow.views,
      completionRate: viewRow.avgCompletion ? Math.round(viewRow.avgCompletion) : 0,
      reviewCount: reviewRow.n,
      avgRating: reviewRow.avg ? Math.round(reviewRow.avg * 10) / 10 : null
    };
  }).sort((a, b) => b.views - a.views);

  const viewTotals = db.prepare(`
    SELECT COUNT(*) AS views, AVG(completion_pct) AS avgCompletion
    FROM film_views WHERE viewed_at >= ? AND viewed_at < ?
  `).get(weekStartSql, weekEndSql);

  const reviewTotals = db.prepare(`
    SELECT COUNT(*) AS n, AVG(rating) AS avg
    FROM reviews WHERE created_at >= ? AND created_at < ?
  `).get(weekStartSql, weekEndSql);

  const fourWeekTrend = [];
  for (let weekAgo = 3; weekAgo >= 0; weekAgo--) {
    const ws = new Date(weekStart.getTime() - weekAgo * 7 * 24 * 60 * 60 * 1000);
    const we = new Date(ws.getTime() + 7 * 24 * 60 * 60 * 1000);
    const count = db.prepare('SELECT COUNT(*) AS n FROM film_views WHERE viewed_at >= ? AND viewed_at < ?')
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
    avgCompletion: viewTotals.avgCompletion ? Math.round(viewTotals.avgCompletion) : 0,
    avgRating: reviewTotals.avg ? Math.round(reviewTotals.avg * 10) / 10 : null,
    totalReviews: reviewTotals.n,
    byFilm: perFilmPerformance,
    trend: fourWeekTrend,
    insights: { mostViewed, highestRated, bestCompletion, topCulture: topCulture ? topCulture[0] : null }
  };

  res.render('admin-reports', { revenueReport, contentReport });
});

module.exports = router;
