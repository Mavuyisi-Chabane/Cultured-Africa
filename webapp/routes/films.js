const express = require('express');
const store = require('../data/store');
const { requireLogin } = require('../middleware/auth');
const paystack = require('../config/paystack');

const router = express.Router();

function hasPurchased(userId, filmId) {
  return store.purchases.some(p => p.userId === userId && p.filmId === filmId);
}

function getFilmDetailContext(film, userId) {
  const filmReviews = store.reviews
    .filter(r => r.filmId === film.id)
    .map(r => ({ ...r, user: store.users.find(u => u.id === r.userId) }))
    .sort((a, b) => b.createdAt - a.createdAt);
  const owned = film.price === 0 || hasPurchased(userId, film.id);
  return { filmReviews, owned };
}

router.get('/', (req, res) => {
  if (!req.session.user) {
    return res.render('landing');
  }

  const culture = req.query.culture;
  const cultures = [...new Set(store.films.map(f => f.culture))];
  const films = culture && culture !== 'All'
    ? store.films.filter(f => f.culture === culture)
    : store.films;

  res.render('home', { films, cultures, activeCulture: culture || 'All' });
});

router.get('/film/:id', requireLogin, (req, res) => {
  const film = store.films.find(f => f.id === Number(req.params.id));
  if (!film) return res.status(404).send('Film not found.');

  const { filmReviews, owned } = getFilmDetailContext(film, req.session.user.id);

  res.render('film-detail', { film, owned, filmReviews, error: null });
});

router.post('/film/:id/buy', requireLogin, async (req, res) => {
  const film = store.films.find(f => f.id === Number(req.params.id));
  if (!film) return res.status(404).send('Film not found.');

  if (film.price === 0 || hasPurchased(req.session.user.id, film.id)) {
    return res.redirect(`/film/${film.id}`);
  }

  const { reference } = req.body;
  const { filmReviews, owned } = getFilmDetailContext(film, req.session.user.id);

  if (!paystack.isConfigured) {
    return res.render('film-detail', {
      film, owned, filmReviews,
      error: 'Payments are not configured yet. Add PAYSTACK_PUBLIC_KEY and PAYSTACK_SECRET_KEY to webapp/.env (see .env.example).'
    });
  }

  if (!reference) {
    return res.render('film-detail', { film, owned, filmReviews, error: 'No payment reference received. Please try again.' });
  }

  try {
    const result = await paystack.verifyTransaction(reference);
    const tx = result && result.data;
    const expectedAmount = Math.round(film.price * 100);
    const paymentOk = result && result.status && tx && tx.status === 'success' && tx.amount === expectedAmount;

    if (!paymentOk) {
      return res.render('film-detail', { film, owned, filmReviews, error: 'Payment could not be verified. You have not been charged for this film — please try again.' });
    }

    store.purchases.push({
      userId: req.session.user.id,
      filmId: film.id,
      price: film.price,
      purchasedAt: new Date(),
      paystackReference: reference
    });
    store.logActivity('Purchase made', film.title);

    res.redirect(`/film/${film.id}`);
  } catch (err) {
    res.render('film-detail', { film, owned, filmReviews, error: 'Could not reach Paystack to verify payment. Please try again.' });
  }
});

router.post('/film/:id/review', requireLogin, (req, res) => {
  const film = store.films.find(f => f.id === Number(req.params.id));
  if (!film) return res.status(404).send('Film not found.');

  const rating = Number(req.body.rating);
  const comment = (req.body.comment || '').trim();

  if (!rating || rating < 1 || rating > 5 || !comment) {
    const { filmReviews, owned } = getFilmDetailContext(film, req.session.user.id);
    return res.render('film-detail', { film, owned, filmReviews, error: 'Please provide a rating (1-5) and a comment.' });
  }

  store.reviews.push({
    id: store.nextIds.nextReviewId(),
    filmId: film.id,
    userId: req.session.user.id,
    rating,
    comment,
    createdAt: new Date(),
    adminReply: null
  });
  store.logActivity('Review submitted', film.title);

  res.redirect(`/film/${film.id}`);
});

module.exports = router;
