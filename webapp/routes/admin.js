const express = require('express');
const fs = require('fs');
const path = require('path');
const store = require('../data/store');
const { requireAdmin } = require('../middleware/auth');
const handleUploads = require('../middleware/upload');

const router = express.Router();

router.use(requireAdmin);

function deleteUploadedFile(urlPath) {
  if (!urlPath || !urlPath.startsWith('/uploads/')) return;
  const filePath = path.join(__dirname, '..', 'public', urlPath);
  fs.unlink(filePath, () => {});
}

router.get('/dashboard', (req, res) => {
  const totalRevenue = store.purchases.reduce((sum, p) => sum + p.price, 0);
  const stats = {
    totalFilms: store.films.length,
    totalUsers: store.users.length,
    totalRevenue,
    totalReviews: store.reviews.length
  };
  const recentActivity = store.activityLog.slice(0, 8);
  res.render('admin-dashboard', { stats, recentActivity });
});

router.get('/films', (req, res) => {
  res.render('admin-manage-films', { films: store.films, error: null });
});

router.post('/films/:id/delete', (req, res) => {
  const id = Number(req.params.id);
  const idx = store.films.findIndex(f => f.id === id);
  if (idx !== -1) {
    const [removed] = store.films.splice(idx, 1);
    deleteUploadedFile(removed.videoUrl);
    deleteUploadedFile(removed.thumbnailUrl);
    deleteUploadedFile(removed.trailerUrl);
    store.logActivity('Film removed', removed.title);
  }
  res.redirect('/admin/films');
});

router.get('/films/:id/edit', (req, res) => {
  const film = store.films.find(f => f.id === Number(req.params.id));
  if (!film) return res.status(404).send('Film not found.');
  res.render('admin-upload', { editing: film, error: null });
});

router.post('/films/:id/edit', handleUploads, (req, res) => {
  const film = store.films.find(f => f.id === Number(req.params.id));
  if (!film) return res.status(404).send('Film not found.');

  const { title, description, culture, price, isFree } = req.body;
  const videoFile = req.files && req.files.videoFile && req.files.videoFile[0];
  const thumbnailFile = req.files && req.files.thumbnailFile && req.files.thumbnailFile[0];
  const trailerFile = req.files && req.files.trailerFile && req.files.trailerFile[0];

  if (!title || !description) {
    return res.render('admin-upload', { editing: { ...film, ...req.body }, error: 'Please fill in all required fields.' });
  }

  if (videoFile) {
    deleteUploadedFile(film.videoUrl);
    film.videoUrl = `/uploads/${videoFile.filename}`;
  }
  if (thumbnailFile) {
    deleteUploadedFile(film.thumbnailUrl);
    film.thumbnailUrl = `/uploads/${thumbnailFile.filename}`;
  }
  if (trailerFile) {
    deleteUploadedFile(film.trailerUrl);
    film.trailerUrl = `/uploads/${trailerFile.filename}`;
  }

  Object.assign(film, {
    title,
    description,
    culture,
    price: isFree ? 0 : Number(price) || 0
  });
  store.logActivity('Film updated', film.title);

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

  const film = {
    id: store.nextIds.nextFilmId(),
    title,
    description,
    culture,
    genre: 'Uncategorized',
    price: isFree ? 0 : Number(price) || 0,
    rating: 0,
    videoUrl: `/uploads/${videoFile.filename}`,
    thumbnailUrl: `/uploads/${thumbnailFile.filename}`,
    trailerUrl: trailerFile ? `/uploads/${trailerFile.filename}` : '',
    uploadedAt: new Date()
  };
  store.films.unshift(film);
  store.logActivity('Film uploaded', film.title);

  res.redirect('/admin/upload');
});

router.get('/feedback', (req, res) => {
  const feedback = store.reviews
    .map(r => ({
      ...r,
      film: store.films.find(f => f.id === r.filmId),
      user: store.users.find(u => u.id === r.userId)
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
  res.render('admin-feedback', { feedback });
});

router.post('/feedback/:id/reply', (req, res) => {
  const review = store.reviews.find(r => r.id === Number(req.params.id));
  if (review) {
    review.adminReply = (req.body.reply || '').trim();
  }
  res.redirect('/admin/feedback');
});

router.get('/reports', (req, res) => {
  const filmReports = store.films.map(film => {
    const filmPurchases = store.purchases.filter(p => p.filmId === film.id);
    const filmReviews = store.reviews.filter(r => r.filmId === film.id);
    const avgRating = filmReviews.length
      ? (filmReviews.reduce((sum, r) => sum + r.rating, 0) / filmReviews.length).toFixed(1)
      : '—';
    return {
      title: film.title,
      culture: film.culture,
      purchaseCount: filmPurchases.length,
      revenue: filmPurchases.reduce((sum, p) => sum + p.price, 0),
      avgRating
    };
  });

  const cultureMap = {};
  store.reviews.forEach(r => {
    const film = store.films.find(f => f.id === r.filmId);
    if (!film) return;
    if (!cultureMap[film.culture]) cultureMap[film.culture] = [];
    cultureMap[film.culture].push(r.rating);
  });
  const cultureReports = Object.entries(cultureMap).map(([culture, ratings]) => ({
    culture,
    avgRating: (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1),
    reviewCount: ratings.length
  }));

  res.render('admin-reports', { filmReports, cultureReports });
});

module.exports = router;
