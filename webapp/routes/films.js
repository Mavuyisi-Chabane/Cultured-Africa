const express = require('express');
const { db, logActivity, notify } = require('../db');
const { requireLogin, redirectAdminAway } = require('../middleware/auth');
const paystack = require('../config/paystack');
const { containsProfanity } = require('../utils/profanityFilter');
const { startOfWeek, toSqlDateTime } = require('../utils/dates');

const router = express.Router();

const CONTENT_SELECT = `
  SELECT c.*, cu.name AS culture_name,
    (SELECT AVG(rating) FROM feedback WHERE content_id = c.content_id AND status = 'published') AS avg_rating
  FROM content c
  JOIN cultures cu ON cu.culture_id = c.culture_id
`;

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
    uploadedAt: new Date(row.upload_date)
  };
}

function getContent(id) {
  const row = db.prepare(`${CONTENT_SELECT} WHERE c.content_id = ?`).get(id);
  return row ? mapContent(row) : null;
}

function hasPurchased(userId, contentId) {
  return Boolean(db.prepare('SELECT 1 FROM purchases WHERE user_id = ? AND content_id = ? LIMIT 1').get(userId, contentId));
}

function getFilmDetailContext(film, userId) {
  const filmReviews = db.prepare(`
    SELECT f.*, u.full_name AS user_full_name
    FROM feedback f
    JOIN users u ON u.user_id = f.user_id
    WHERE f.content_id = ? AND f.status = 'published'
    ORDER BY f.submitted_date DESC
  `).all(film.id).map(r => ({
    id: r.feedback_id,
    rating: r.rating,
    comment: r.comment,
    adminReply: r.admin_reply,
    createdAt: new Date(r.submitted_date),
    user: { fullName: r.user_full_name }
  }));

  const owned = film.price === 0 || hasPurchased(userId, film.id);
  return { filmReviews, owned };
}

router.get('/', redirectAdminAway, (req, res) => {
  if (!req.session.user) {
    return res.render('landing');
  }

  const userId = req.session.user.id;
  const culture = req.query.culture;
  const cultures = db.prepare('SELECT name FROM cultures ORDER BY name').all().map(r => r.name);
  const rows = culture && culture !== 'All'
    ? db.prepare(`${CONTENT_SELECT} WHERE c.is_available = 1 AND cu.name = ? ORDER BY c.upload_date DESC`).all(culture)
    : db.prepare(`${CONTENT_SELECT} WHERE c.is_available = 1 ORDER BY c.upload_date DESC`).all();

  const purchasedIds = new Set(
    db.prepare('SELECT DISTINCT content_id FROM purchases WHERE user_id = ?').all(userId).map(r => r.content_id)
  );

  const films = rows.map(row => {
    const film = mapContent(row);
    film.owned = film.price === 0 || purchasedIds.has(film.id);
    return film;
  });

  res.render('home', { films, cultures, activeCulture: culture || 'All' });
});

router.get('/library', redirectAdminAway, requireLogin, (req, res) => {
  const userId = req.session.user.id;
  const rows = db.prepare(`
    ${CONTENT_SELECT}
    WHERE c.is_available = 1
      AND (c.price = 0 OR EXISTS (SELECT 1 FROM purchases WHERE content_id = c.content_id AND user_id = ?))
  `).all(userId);

  const purchaseDates = new Map(
    db.prepare('SELECT content_id, MAX(purchase_date) AS purchased_at FROM purchases WHERE user_id = ? GROUP BY content_id')
      .all(userId)
      .map(r => [r.content_id, r.purchased_at])
  );

  const films = rows
    .map(row => ({
      ...mapContent(row),
      purchasedAt: purchaseDates.has(row.content_id) ? new Date(purchaseDates.get(row.content_id)) : null
    }))
    .sort((a, b) => (b.purchasedAt || b.uploadedAt) - (a.purchasedAt || a.uploadedAt));

  res.render('library', { films });
});

router.get('/recap', redirectAdminAway, requireLogin, (req, res) => {
  const userId = req.session.user.id;
  const period = ['week', 'month', 'all'].includes(req.query.period) ? req.query.period : 'all';

  const now = new Date();
  let periodStart = null;
  let periodLabel = 'All Time';
  if (period === 'week') {
    periodStart = startOfWeek(now);
    periodLabel = 'This Week';
  } else if (period === 'month') {
    periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    periodLabel = 'This Month';
  }
  const periodStartSql = periodStart ? toSqlDateTime(periodStart) : '2000-01-01 00:00:00';

  // Sourced from watch_progress (furthest position ever reached per film), not the
  // watch_history session log — summing session log directly would double-count
  // any film rewatched across multiple visits.
  const watchTotals = db.prepare(`
    SELECT COALESCE(SUM(position_seconds), 0) AS totalSeconds, COUNT(*) AS filmsWatched
    FROM watch_progress WHERE user_id = ? AND updated_at >= ?
  `).get(userId, periodStartSql);

  const spendTotals = db.prepare(`
    SELECT COALESCE(SUM(amount_paid), 0) AS totalSpent, COUNT(*) AS purchaseCount
    FROM purchases WHERE user_id = ? AND payment_status = 'completed' AND purchase_date >= ?
  `).get(userId, periodStartSql);

  const mostWatched = db.prepare(`
    SELECT c.content_id, c.title, c.thumbnail_url, cu.name AS culture, wp.position_seconds AS totalSeconds,
      (SELECT COUNT(*) FROM watch_history wh WHERE wh.user_id = wp.user_id AND wh.content_id = wp.content_id) AS sessions
    FROM watch_progress wp
    JOIN content c ON c.content_id = wp.content_id
    JOIN cultures cu ON cu.culture_id = c.culture_id
    WHERE wp.user_id = ? AND wp.updated_at >= ?
    ORDER BY totalSeconds DESC
    LIMIT 5
  `).all(userId, periodStartSql);

  const purchaseHistory = db.prepare(`
    SELECT c.title, p.amount_paid, p.purchase_date
    FROM purchases p
    JOIN content c ON c.content_id = p.content_id
    WHERE p.user_id = ? AND p.payment_status = 'completed' AND p.purchase_date >= ?
    ORDER BY p.purchase_date DESC
  `).all(userId, periodStartSql).map(r => ({ title: r.title, amountPaid: r.amount_paid, purchasedAt: new Date(r.purchase_date) }));

  res.render('recap', {
    period, periodLabel,
    totalMinutes: Math.round(watchTotals.totalSeconds / 60),
    filmsWatched: watchTotals.filmsWatched,
    totalSpent: spendTotals.totalSpent,
    purchaseCount: spendTotals.purchaseCount,
    mostWatched: mostWatched.map(f => ({
      id: f.content_id, title: f.title, thumbnailUrl: f.thumbnail_url, culture: f.culture,
      minutes: Math.round(f.totalSeconds / 60), sessions: f.sessions
    })),
    purchaseHistory
  });
});

router.get('/film/:id', redirectAdminAway, requireLogin, (req, res) => {
  const film = getContent(req.params.id);
  if (!film) return res.status(404).send('Film not found.');

  const { filmReviews, owned } = getFilmDetailContext(film, req.session.user.id);

  let viewId = null;
  let resumeSeconds = 0;
  let resumeCompleted = false;
  if (owned) {
    viewId = db.prepare('INSERT INTO watch_history (content_id, user_id, progress_seconds, completed) VALUES (?, ?, 0, 0)')
      .run(film.id, req.session.user.id).lastInsertRowid;

    const progress = db.prepare('SELECT position_seconds, completed FROM watch_progress WHERE user_id = ? AND content_id = ?')
      .get(req.session.user.id, film.id);
    if (progress) {
      resumeSeconds = progress.position_seconds;
      resumeCompleted = Boolean(progress.completed);
    }
  }

  res.render('film-detail', { film, owned, filmReviews, viewId, resumeSeconds, resumeCompleted, error: null });
});

router.post('/film/:id/track-progress', redirectAdminAway, requireLogin, (req, res) => {
  const { viewId, progressSeconds, completed } = req.body;
  if (viewId && typeof progressSeconds === 'number' && Number.isFinite(progressSeconds)) {
    const seconds = Math.max(0, Math.round(progressSeconds));
    const isCompleted = completed ? 1 : 0;
    const userId = req.session.user.id;
    const contentId = Number(req.params.id);

    db.prepare(`
      UPDATE watch_history
      SET progress_seconds = MAX(progress_seconds, ?), completed = MAX(completed, ?)
      WHERE history_id = ? AND user_id = ? AND content_id = ?
    `).run(seconds, isCompleted, Number(viewId), userId, contentId);

    // Furthest-ever position for this user+film, independent of the session log above —
    // this is what lets playback resume where it left off, and keeps "minutes watched"
    // from double-counting when the same stretch is rewatched across sessions.
    db.prepare(`
      INSERT INTO watch_progress (user_id, content_id, position_seconds, completed, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id, content_id) DO UPDATE SET
        position_seconds = MAX(position_seconds, excluded.position_seconds),
        completed = MAX(completed, excluded.completed),
        updated_at = datetime('now')
    `).run(userId, contentId, seconds, isCompleted);
  }
  res.status(204).end();
});

router.post('/film/:id/buy', redirectAdminAway, requireLogin, async (req, res) => {
  const film = getContent(req.params.id);
  if (!film) return res.status(404).send('Film not found.');

  if (film.price === 0 || hasPurchased(req.session.user.id, film.id)) {
    return res.redirect(`/film/${film.id}`);
  }

  const { reference } = req.body;
  const { filmReviews, owned } = getFilmDetailContext(film, req.session.user.id);

  if (!paystack.isConfigured) {
    return res.render('film-detail', {
      film, owned, filmReviews, viewId: null, resumeSeconds: 0, resumeCompleted: false,
      error: 'Payments are not configured yet. Add PAYSTACK_PUBLIC_KEY and PAYSTACK_SECRET_KEY to webapp/.env (see .env.example).'
    });
  }

  if (!reference) {
    return res.render('film-detail', { film, owned, filmReviews, viewId: null, resumeSeconds: 0, resumeCompleted: false, error: 'No payment reference received. Please try again.' });
  }

  try {
    const result = await paystack.verifyTransaction(reference);
    const tx = result && result.data;
    const expectedAmount = Math.round(film.price * 100);
    const paymentOk = result && result.status && tx && tx.status === 'success' && tx.amount === expectedAmount;

    if (!paymentOk) {
      return res.render('film-detail', { film, owned, filmReviews, viewId: null, resumeSeconds: 0, resumeCompleted: false, error: 'Payment could not be verified. You have not been charged for this film — please try again.' });
    }

    db.prepare(`
      INSERT INTO purchases (user_id, content_id, amount_paid, payment_status, transaction_ref)
      VALUES (?, ?, ?, 'completed', ?)
    `).run(req.session.user.id, film.id, film.price, reference);
    logActivity('Purchase made', film.title);
    notify(req.session.user.id, 'purchase_confirmation', `Your purchase of "${film.title}" was successful. Enjoy the film!`);

    res.redirect(`/film/${film.id}`);
  } catch (err) {
    res.render('film-detail', { film, owned, filmReviews, viewId: null, resumeSeconds: 0, resumeCompleted: false, error: 'Could not reach Paystack to verify payment. Please try again.' });
  }
});

router.post('/film/:id/review', redirectAdminAway, requireLogin, (req, res) => {
  const film = getContent(req.params.id);
  if (!film) return res.status(404).send('Film not found.');

  const { filmReviews, owned } = getFilmDetailContext(film, req.session.user.id);

  if (!owned) {
    return res.render('film-detail', { film, owned, filmReviews, viewId: null, resumeSeconds: 0, resumeCompleted: false, error: 'You can only review films you own. Buy this film to leave a review.' });
  }

  const ratingRaw = (req.body.rating || '').trim();
  const comment = (req.body.comment || '').trim();
  const rating = ratingRaw ? Number(ratingRaw) : null;

  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
    return res.render('film-detail', { film, owned, filmReviews, viewId: null, resumeSeconds: 0, resumeCompleted: false, error: 'Rating must be between 1 and 5.' });
  }
  if (rating === null && !comment) {
    return res.render('film-detail', { film, owned, filmReviews, viewId: null, resumeSeconds: 0, resumeCompleted: false, error: 'Please provide a rating, a comment, or both.' });
  }
  if (comment && containsProfanity(comment)) {
    logActivity('Comment blocked (inappropriate language)', film.title);
    return res.render('film-detail', {
      film, owned, filmReviews, viewId: null, resumeSeconds: 0, resumeCompleted: false,
      error: 'Your comment was not published because it contains inappropriate language. Please rephrase it and try again.'
    });
  }

  db.prepare('INSERT INTO feedback (content_id, user_id, rating, comment) VALUES (?, ?, ?, ?)')
    .run(film.id, req.session.user.id, rating, comment || null);
  logActivity('Review submitted', film.title);

  res.redirect(`/film/${film.id}`);
});

module.exports = router;
