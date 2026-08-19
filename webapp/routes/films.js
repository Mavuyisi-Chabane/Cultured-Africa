const express = require('express');
const { db, logActivity } = require('../db');
const { requireLogin } = require('../middleware/auth');
const paystack = require('../config/paystack');

const router = express.Router();

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

function hasPurchased(userId, filmId) {
  return Boolean(db.prepare('SELECT 1 FROM purchases WHERE user_id = ? AND film_id = ? LIMIT 1').get(userId, filmId));
}

function updateFilmRating(filmId) {
  const row = db.prepare('SELECT AVG(rating) AS avg FROM reviews WHERE film_id = ?').get(filmId);
  const rating = row.avg ? Math.round(row.avg * 10) / 10 : 0;
  db.prepare('UPDATE films SET rating = ? WHERE id = ?').run(rating, filmId);
}

function getFilmDetailContext(film, userId) {
  const filmReviews = db.prepare(`
    SELECT r.*, u.full_name AS user_full_name
    FROM reviews r
    JOIN users u ON u.id = r.user_id
    WHERE r.film_id = ?
    ORDER BY r.created_at DESC
  `).all(film.id).map(r => ({
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    adminReply: r.admin_reply,
    createdAt: new Date(r.created_at),
    user: { fullName: r.user_full_name }
  }));

  const owned = film.price === 0 || hasPurchased(userId, film.id);
  return { filmReviews, owned };
}

router.get('/', (req, res) => {
  if (!req.session.user) {
    return res.render('landing');
  }

  const culture = req.query.culture;
  const cultures = db.prepare('SELECT DISTINCT culture FROM films ORDER BY culture').all().map(r => r.culture);
  const rows = culture && culture !== 'All'
    ? db.prepare('SELECT * FROM films WHERE culture = ? ORDER BY uploaded_at DESC').all(culture)
    : db.prepare('SELECT * FROM films ORDER BY uploaded_at DESC').all();

  res.render('home', { films: rows.map(mapFilm), cultures, activeCulture: culture || 'All' });
});

router.get('/film/:id', requireLogin, (req, res) => {
  const film = getFilm(req.params.id);
  if (!film) return res.status(404).send('Film not found.');

  const { filmReviews, owned } = getFilmDetailContext(film, req.session.user.id);

  let viewId = null;
  if (owned) {
    viewId = db.prepare('INSERT INTO film_views (film_id, user_id, completion_pct) VALUES (?, ?, 0)')
      .run(film.id, req.session.user.id).lastInsertRowid;
  }

  res.render('film-detail', { film, owned, filmReviews, viewId, error: null });
});

router.post('/film/:id/track-progress', requireLogin, (req, res) => {
  const { viewId, pct } = req.body;
  if (viewId && typeof pct === 'number' && Number.isFinite(pct)) {
    db.prepare(`
      UPDATE film_views SET completion_pct = MAX(completion_pct, ?)
      WHERE id = ? AND user_id = ? AND film_id = ?
    `).run(Math.min(100, Math.max(0, pct)), Number(viewId), req.session.user.id, Number(req.params.id));
  }
  res.status(204).end();
});

router.post('/film/:id/buy', requireLogin, async (req, res) => {
  const film = getFilm(req.params.id);
  if (!film) return res.status(404).send('Film not found.');

  if (film.price === 0 || hasPurchased(req.session.user.id, film.id)) {
    return res.redirect(`/film/${film.id}`);
  }

  const { reference } = req.body;
  const { filmReviews, owned } = getFilmDetailContext(film, req.session.user.id);

  if (!paystack.isConfigured) {
    return res.render('film-detail', {
      film, owned, filmReviews, viewId: null,
      error: 'Payments are not configured yet. Add PAYSTACK_PUBLIC_KEY and PAYSTACK_SECRET_KEY to webapp/.env (see .env.example).'
    });
  }

  if (!reference) {
    return res.render('film-detail', { film, owned, filmReviews, viewId: null, error: 'No payment reference received. Please try again.' });
  }

  try {
    const result = await paystack.verifyTransaction(reference);
    const tx = result && result.data;
    const expectedAmount = Math.round(film.price * 100);
    const paymentOk = result && result.status && tx && tx.status === 'success' && tx.amount === expectedAmount;

    if (!paymentOk) {
      return res.render('film-detail', { film, owned, filmReviews, viewId: null, error: 'Payment could not be verified. You have not been charged for this film — please try again.' });
    }

    db.prepare(`
      INSERT INTO purchases (user_id, film_id, price, paystack_reference)
      VALUES (?, ?, ?, ?)
    `).run(req.session.user.id, film.id, film.price, reference);
    logActivity('Purchase made', film.title);

    res.redirect(`/film/${film.id}`);
  } catch (err) {
    res.render('film-detail', { film, owned, filmReviews, viewId: null, error: 'Could not reach Paystack to verify payment. Please try again.' });
  }
});

router.post('/film/:id/review', requireLogin, (req, res) => {
  const film = getFilm(req.params.id);
  if (!film) return res.status(404).send('Film not found.');

  const rating = Number(req.body.rating);
  const comment = (req.body.comment || '').trim();

  if (!rating || rating < 1 || rating > 5 || !comment) {
    const { filmReviews, owned } = getFilmDetailContext(film, req.session.user.id);
    return res.render('film-detail', { film, owned, filmReviews, viewId: null, error: 'Please provide a rating (1-5) and a comment.' });
  }

  db.prepare('INSERT INTO reviews (film_id, user_id, rating, comment) VALUES (?, ?, ?, ?)')
    .run(film.id, req.session.user.id, rating, comment);
  updateFilmRating(film.id);
  logActivity('Review submitted', film.title);

  res.redirect(`/film/${film.id}`);
});

module.exports = router;
