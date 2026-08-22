const express = require('express');
const { db, logActivity, notify } = require('../db');
const { requireLogin } = require('../middleware/auth');
const paystack = require('../config/paystack');

const router = express.Router();

const CONTENT_SELECT = `
  SELECT c.*, cu.name AS culture_name,
    (SELECT AVG(rating) FROM feedback WHERE content_id = c.content_id) AS avg_rating
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
    WHERE f.content_id = ?
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

router.get('/', (req, res) => {
  if (!req.session.user) {
    return res.render('landing');
  }

  const culture = req.query.culture;
  const cultures = db.prepare('SELECT name FROM cultures ORDER BY name').all().map(r => r.name);
  const rows = culture && culture !== 'All'
    ? db.prepare(`${CONTENT_SELECT} WHERE c.is_available = 1 AND cu.name = ? ORDER BY c.upload_date DESC`).all(culture)
    : db.prepare(`${CONTENT_SELECT} WHERE c.is_available = 1 ORDER BY c.upload_date DESC`).all();

  res.render('home', { films: rows.map(mapContent), cultures, activeCulture: culture || 'All' });
});

router.get('/library', requireLogin, (req, res) => {
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

router.get('/film/:id', requireLogin, (req, res) => {
  const film = getContent(req.params.id);
  if (!film) return res.status(404).send('Film not found.');

  const { filmReviews, owned } = getFilmDetailContext(film, req.session.user.id);

  let viewId = null;
  if (owned) {
    viewId = db.prepare('INSERT INTO watch_history (content_id, user_id, progress_seconds, completed) VALUES (?, ?, 0, 0)')
      .run(film.id, req.session.user.id).lastInsertRowid;
  }

  res.render('film-detail', { film, owned, filmReviews, viewId, error: null });
});

router.post('/film/:id/track-progress', requireLogin, (req, res) => {
  const { viewId, progressSeconds, completed } = req.body;
  if (viewId && typeof progressSeconds === 'number' && Number.isFinite(progressSeconds)) {
    db.prepare(`
      UPDATE watch_history
      SET progress_seconds = MAX(progress_seconds, ?), completed = MAX(completed, ?)
      WHERE history_id = ? AND user_id = ? AND content_id = ?
    `).run(Math.max(0, Math.round(progressSeconds)), completed ? 1 : 0, Number(viewId), req.session.user.id, Number(req.params.id));
  }
  res.status(204).end();
});

router.post('/film/:id/buy', requireLogin, async (req, res) => {
  const film = getContent(req.params.id);
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
      INSERT INTO purchases (user_id, content_id, amount_paid, payment_status, transaction_ref)
      VALUES (?, ?, ?, 'completed', ?)
    `).run(req.session.user.id, film.id, film.price, reference);
    logActivity('Purchase made', film.title);
    notify(req.session.user.id, 'purchase_confirmation', `Your purchase of "${film.title}" was successful. Enjoy the film!`);

    res.redirect(`/film/${film.id}`);
  } catch (err) {
    res.render('film-detail', { film, owned, filmReviews, viewId: null, error: 'Could not reach Paystack to verify payment. Please try again.' });
  }
});

router.post('/film/:id/review', requireLogin, (req, res) => {
  const film = getContent(req.params.id);
  if (!film) return res.status(404).send('Film not found.');

  const rating = Number(req.body.rating);
  const comment = (req.body.comment || '').trim();

  if (!rating || rating < 1 || rating > 5 || !comment) {
    const { filmReviews, owned } = getFilmDetailContext(film, req.session.user.id);
    return res.render('film-detail', { film, owned, filmReviews, viewId: null, error: 'Please provide a rating (1-5) and a comment.' });
  }

  db.prepare('INSERT INTO feedback (content_id, user_id, rating, comment) VALUES (?, ?, ?, ?)')
    .run(film.id, req.session.user.id, rating, comment);
  logActivity('Review submitted', film.title);

  res.redirect(`/film/${film.id}`);
});

module.exports = router;
