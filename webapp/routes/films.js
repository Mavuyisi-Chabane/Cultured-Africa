const express = require('express');
const { GENRES, genreLabel, durationLabel, parseDuration } = require('../config/genres');
const path = require('path');
const crypto = require('crypto');
const { UPLOAD_DIR } = require('../middleware/upload');
const { describeRating, AGE_CONFIRMATION_RATINGS } = require('../config/ageRatings');
const { db, logActivity, customerActor, notify } = require('../db');
const { requireLogin, redirectAdminAway } = require('../middleware/auth');
const paystack = require('../config/paystack');
const { getReceipt } = require('../utils/receipts');
const { sendPurchaseReceipt } = require('../services/email');
const { containsProfanity } = require('../utils/profanityFilter');
const { startOfWeek, toSqlDateTime } = require('../utils/dates');

const router = express.Router();

function renderNotFound(res) {
  return res.status(404).render('error', {
    status: 404, title: 'Film not found', message: "This film doesn't exist or is no longer available."
  });
}

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
    genreLabel: genreLabel(row.content_type),
    durationSeconds: row.duration_seconds || 0,
    durationLabel: durationLabel(row.duration_seconds),
    price: row.price,
    rating: row.avg_rating ? Math.round(row.avg_rating * 10) / 10 : 0,
    videoUrl: row.file_url,
    thumbnailUrl: row.thumbnail_url,
    trailerUrl: row.trailer_url,
    // Uploaded with only a trailer: shown and previewable, but not yet buyable or playable.
    comingSoon: !row.file_url,
    isAvailable: Boolean(row.is_available),
    ageRestricted: AGE_CONFIRMATION_RATINGS.has(row.age_rating),
    ageRatingCode: row.age_rating || '',
    advisoryCodes: String(row.content_advisories || '').split(',').filter(Boolean),
    classification: describeRating(row.age_rating, row.content_advisories),
    description: row.description,
    uploadedAt: new Date(row.upload_date)
  };
}

function getContent(id) {
  const row = db.prepare(`${CONTENT_SELECT} WHERE c.content_id = ?`).get(id);
  return row ? mapContent(row) : null;
}

const { ACCESS_MONTHS } = require('../config/access');
const purchaseTerms = require('../config/purchaseTerms');
const ACCESS_EXPIRES_SQL = `datetime(purchase_date, '+${ACCESS_MONTHS} months')`;

// Lets every customer page describe the access period without hard-coding "6 months".
router.use((req, res, next) => {
  res.locals.accessMonths = ACCESS_MONTHS;
  res.locals.purchaseTerms = purchaseTerms;
  next();
});

// SQLite datetime() values are UTC 'YYYY-MM-DD HH:MM:SS' with no zone marker.
function parseDbDate(value) {
  return value ? new Date(value.replace(' ', 'T') + 'Z') : null;
}

// The user's most recent completed purchase of a film, or null if they never bought it.
function getAccess(userId, contentId) {
  const row = db.prepare(`
    SELECT purchase_date, ${ACCESS_EXPIRES_SQL} AS expires_at, ${ACCESS_EXPIRES_SQL} > datetime('now') AS active
    FROM purchases
    WHERE user_id = ? AND content_id = ? AND payment_status = 'completed'
    ORDER BY purchase_date DESC LIMIT 1
  `).get(userId, contentId);
  return row
    ? { purchasedAt: parseDbDate(row.purchase_date), expiresAt: parseDbDate(row.expires_at), active: Boolean(row.active) }
    : null;
}

// content_id -> access expiry for every film this user can currently watch because they paid for it.
function getActiveAccessMap(userId) {
  return new Map(db.prepare(`
    SELECT content_id, MAX(${ACCESS_EXPIRES_SQL}) AS expires_at
    FROM purchases
    WHERE user_id = ? AND payment_status = 'completed'
    GROUP BY content_id
    HAVING MAX(${ACCESS_EXPIRES_SQL}) > datetime('now')
  `).all(userId).map(r => [r.content_id, parseDbDate(r.expires_at)]));
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
    edited: Boolean(r.edited_at),
    userId: r.user_id,
    user: { fullName: r.user_full_name }
  }));

  if (film.comingSoon || !userId) return { filmReviews, owned: false, access: null, canReview: false };

  const access = film.price === 0 ? null : getAccess(userId, film.id);
  const owned = film.price === 0 || Boolean(access && access.active);
  // Anyone who has ever had access may review, so expiry doesn't silence past viewers.
  const canReview = film.price === 0 || Boolean(access);
  return { filmReviews, owned, access, canReview };
}

// Home catalogue sort options: key -> [label, ORDER BY]. "Most watched" counts every
// viewing session in watch_history; newest upload breaks ties throughout.
const HOME_SORTS = {
  newest: ['Newest', 'c.upload_date DESC'],
  'most-watched': ['Most watched', 'watch_count DESC, c.upload_date DESC'],
  'top-rated': ['Top rated', 'avg_rating IS NULL, avg_rating DESC, c.upload_date DESC'],
  'price-asc': ['Price: low to high', 'c.price ASC, c.upload_date DESC'],
  'price-desc': ['Price: high to low', 'c.price DESC, c.upload_date DESC']
};
const HOME_PRICES = { all: 'All prices', free: 'Free', paid: 'Paid' };
const MAX_SEARCH_LENGTH = 100;
const MAX_FEATURED_TRAILERS = 6;

// Escapes LIKE wildcards so a search for "100%" matches literally ('!' is the ESCAPE
// character used in the query below).
function likePattern(term) {
  return `%${term.replace(/[!%_]/g, ch => '!' + ch)}%`;
}

router.get('/', redirectAdminAway, (req, res) => {
  if (!req.session.user) {
    // The public landing page's "Featured Films" are whichever available films have a
    // trailer uploaded through the admin portal — trailers are free to watch, no login.
    const featuredFilms = db.prepare(`
      ${CONTENT_SELECT}
      WHERE c.is_available = 1 AND c.trailer_url IS NOT NULL AND c.trailer_url != ''
      ORDER BY c.upload_date DESC
      LIMIT ?
    `).all(MAX_FEATURED_TRAILERS).map(mapContent);
    const NEWSLETTER_NOTICES = {
      sent: { ok: true, text: "Almost done: check your inbox and click the link to confirm your subscription." },
      invalid: { ok: false, text: 'Please enter a valid email address.' },
      busy: { ok: false, text: 'Too many sign-ups from your connection. Please try again in a few minutes.' }
    };
    // "Voices from our community": real, published customer reviews only (with a comment
    // and 4+ stars), shown as first name + last initial. Hidden when there are none yet.
    const communityReviews = db.prepare(`
      SELECT f.rating, f.comment, u.full_name, c.content_id, c.title
      FROM feedback f
      JOIN users u ON u.user_id = f.user_id
      JOIN content c ON c.content_id = f.content_id
      WHERE f.status = 'published' AND c.is_available = 1
        AND f.comment IS NOT NULL AND trim(f.comment) != '' AND f.rating >= 4
      ORDER BY f.submitted_date DESC
      LIMIT 3
    `).all().map(r => {
      const parts = String(r.full_name).trim().split(/\s+/);
      return {
        rating: r.rating,
        comment: r.comment,
        name: parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0],
        filmId: r.content_id,
        filmTitle: r.title
      };
    });
    return res.render('landing', { featuredFilms, communityReviews, newsletterNotice: NEWSLETTER_NOTICES[req.query.newsletter] || null });
  }

  renderCatalogue(req, res, '/');
});

// The public catalogue: anyone can browse, filter, search and watch trailers here.
// Buying or watching a full film asks visitors to sign in first (see film-detail).
router.get('/films', redirectAdminAway, (req, res) => {
  // Logged-in customers browse on Home, which is the same catalogue; keep their filters.
  if (req.session.user) {
    const qs = new URLSearchParams(req.query).toString();
    return res.redirect(qs ? `/?${qs}` : '/');
  }
  renderCatalogue(req, res, '/films');
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// Description as safe HTML with each searched word wrapped in <mark>. Escaping happens
// first, so the only markup in the result is the <mark> tags added here.
function highlightMatches(text, words) {
  let html = escapeHtml(text);
  words.forEach(word => {
    const escapedWord = escapeHtml(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    html = html.replace(new RegExp(`(${escapedWord})(?![^<]*>)`, 'gi'), '<mark>$1</mark>');
  });
  return html;
}

// "Continue watching" on Home: films the customer started but didn't finish, most
// recent first, using the resume positions the player already saves. Only films they
// can still play (free, or bought and within the access period) are included. A film
// counts as started after 10 seconds (when the player starts offering to resume) and
// drops out once the player marks it finished (90% watched).
const CONTINUE_WATCHING_LIMIT = 6;
function getContinueWatching(userId, activeAccess) {
  return db.prepare(`
    SELECT c.*, cu.name AS culture_name, wp.position_seconds,
      (SELECT AVG(rating) FROM feedback WHERE content_id = c.content_id AND status = 'published') AS avg_rating
    FROM content c
    JOIN cultures cu ON cu.culture_id = c.culture_id
    JOIN watch_progress wp ON wp.content_id = c.content_id AND wp.user_id = ?
    WHERE c.is_available = 1 AND c.file_url != '' AND wp.completed = 0 AND wp.position_seconds >= 10
    ORDER BY wp.updated_at DESC
  `).all(userId).map(row => {
    const film = mapContent(row);
    const position = row.position_seconds;
    const duration = film.durationSeconds;
    film.progressPercent = duration ? Math.min(100, Math.round((position / duration) * 100)) : null;
    film.timeLeftLabel = duration ? durationLabel(Math.max(60, duration - position)) : '';
    return film;
  }).filter(f => f.price === 0 || activeAccess.has(f.id))
    .slice(0, CONTINUE_WATCHING_LIMIT);
}

function renderCatalogue(req, res, basePath) {
  const userId = req.session.user ? req.session.user.id : null;
  const cultures = db.prepare('SELECT name FROM cultures ORDER BY name').all().map(r => r.name);

  // Every filter is validated against a fixed list, so anything unexpected in the URL
  // just falls back to the default rather than erroring or reaching the SQL.
  const filters = {
    q: String(req.query.q || '').trim().slice(0, MAX_SEARCH_LENGTH),
    culture: cultures.includes(req.query.culture) ? req.query.culture : 'All',
    price: HOME_PRICES[req.query.price] ? req.query.price : 'all',
    sort: HOME_SORTS[req.query.sort] ? req.query.sort : 'newest'
  };

  const where = ['c.is_available = 1'];
  const params = [];
  // Each word must appear somewhere in the title, culture, genre or description, so
  // "zulu drama" finds Zulu dramas rather than needing that exact phrase.
  filters.q.split(/\s+/).filter(Boolean).forEach(word => {
    where.push(`(c.title || ' ' || cu.name || ' ' || c.content_type || ' ' || c.description) LIKE ? ESCAPE '!'`);
    params.push(likePattern(word));
  });
  if (filters.culture !== 'All') {
    where.push('cu.name = ?');
    params.push(filters.culture);
  }
  if (filters.price === 'free') where.push('c.price = 0');
  if (filters.price === 'paid') where.push('c.price > 0');

  const rows = db.prepare(`
    SELECT * FROM (
      SELECT c.*, cu.name AS culture_name,
        (SELECT AVG(rating) FROM feedback WHERE content_id = c.content_id AND status = 'published') AS avg_rating,
        (SELECT COUNT(*) FROM watch_history WHERE content_id = c.content_id) AS watch_count
      FROM content c
      JOIN cultures cu ON cu.culture_id = c.culture_id
      WHERE ${where.join(' AND ')}
    ) c
    ORDER BY ${HOME_SORTS[filters.sort][1]}
  `).all(...params);

  const activeAccess = userId ? getActiveAccessMap(userId) : new Map();
  const searchWords = filters.q.split(/\s+/).filter(Boolean);

  const films = rows.map(row => {
    const film = mapContent(row);
    film.owned = Boolean(userId) && !film.comingSoon && (film.price === 0 || activeAccess.has(film.id));
    film.accessExpiresAt = activeAccess.get(film.id) || null;
    film.watchCount = row.watch_count;
    film.descriptionHtml = highlightMatches(film.description, searchWords);
    return film;
  });

  res.render('home', {
    films, cultures, filters, basePath,
    continueWatching: userId ? getContinueWatching(userId, activeAccess) : [],
    isGuest: !userId,
    sortOptions: Object.entries(HOME_SORTS).map(([value, [label]]) => ({ value, label })),
    priceOptions: Object.entries(HOME_PRICES).map(([value, label]) => ({ value, label }))
  });
}

router.get('/library', redirectAdminAway, requireLogin, (req, res) => {
  const userId = req.session.user.id;
  const available = db.prepare(`${CONTENT_SELECT} WHERE c.is_available = 1`).all();
  const latestPurchase = new Map(db.prepare(`
    SELECT content_id, MAX(purchase_date) AS purchased_at, MAX(${ACCESS_EXPIRES_SQL}) AS expires_at
    FROM purchases WHERE user_id = ? AND payment_status = 'completed'
    GROUP BY content_id
  `).all(userId).map(r => [r.content_id, { purchasedAt: parseDbDate(r.purchased_at), expiresAt: parseDbDate(r.expires_at) }]));

  const now = new Date();
  const films = [];
  const expiredFilms = [];
  available.forEach(row => {
    const purchase = latestPurchase.get(row.content_id);
    const film = { ...mapContent(row), purchasedAt: purchase ? purchase.purchasedAt : null, accessExpiresAt: purchase ? purchase.expiresAt : null };
    if (film.comingSoon) return;
    if (film.price === 0) films.push(film);
    else if (purchase && purchase.expiresAt > now) films.push(film);
    else if (purchase) expiredFilms.push(film);
  });

  films.sort((a, b) => (b.purchasedAt || b.uploadedAt) - (a.purchasedAt || a.uploadedAt));
  expiredFilms.sort((a, b) => b.accessExpiresAt - a.accessExpiresAt);

  res.render('library', { films, expiredFilms });
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

// The only way a full film is ever delivered: /uploads refuses film files (see
// middleware/uploadsAccess.js), so the viewer must be logged in and own the film (or it
// must be free). res.sendFile handles HTTP Range requests, so seeking still works.
router.get('/film/:id/stream', redirectAdminAway, requireLogin, (req, res) => {
  const film = getContent(req.params.id);
  if (!film || !film.videoUrl || !film.videoUrl.startsWith('/uploads/')) return renderNotFound(res);

  const { owned } = getFilmDetailContext(film, req.session.user.id);
  if (!owned) {
    return res.status(403).render('error', {
      status: 403, title: 'Purchase required', message: 'Buy this film to watch it.'
    });
  }

  // One device at a time: only the browser tab that last pressed Play on this account
  // (see /playback/claim) gets video. Any other tab's requests are refused straight away.
  const active = db.prepare('SELECT active_playback_token FROM users WHERE user_id = ?').get(req.session.user.id);
  if (!req.query.pt || !active || req.query.pt !== active.active_playback_token) {
    return res.status(409).type('text').send('This account is watching on another device.');
  }

  const filePath = path.join(UPLOAD_DIR, path.basename(film.videoUrl));
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', 'inline');
  res.sendFile(filePath, err => {
    if (err && !res.headersSent) renderNotFound(res);
  });
});

router.get('/film/:id', redirectAdminAway, (req, res) => {
  const film = getContent(req.params.id);
  if (!film) return renderNotFound(res);

  const userId = req.session.user ? req.session.user.id : null;
  const { filmReviews, owned, access, canReview } = getFilmDetailContext(film, userId);
  if (!film.isAvailable && !owned) return renderNotFound(res);

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

  const playbackToken = owned ? crypto.randomBytes(16).toString('hex') : null;
  res.render('film-detail', { film, owned, filmReviews, access, canReview, viewId, resumeSeconds, resumeCompleted, playbackToken, error: null });
});

// One-time "I am 18 or older" for this account, asked on the first 18-rated film.
router.post('/film/:id/confirm-age', redirectAdminAway, requireLogin, (req, res) => {
  const film = getContent(req.params.id);
  if (!film) return renderNotFound(res);
  if (req.body.ageConfirm === 'yes') {
    db.prepare("UPDATE users SET adult_confirmed_at = datetime('now') WHERE user_id = ? AND adult_confirmed_at IS NULL")
      .run(req.session.user.id);
    req.session.user.adultConfirmed = true;
    logActivity('Age confirmed (18+)', req.session.user.fullName, customerActor(req.session.user.fullName));
  }
  res.redirect(`/film/${film.id}`);
});

const PLAYBACK_TOKEN_FORMAT = /^[a-f0-9]{32}$/;

// Pressing Play: this tab becomes the account's one active device, taking over from
// any other device (which is told to stop on its next heartbeat).
router.post('/film/:id/playback/claim', redirectAdminAway, requireLogin, (req, res) => {
  const film = getContent(req.params.id);
  if (!film) return res.status(404).json({ ok: false });
  const { owned } = getFilmDetailContext(film, req.session.user.id);
  const token = String(req.body.playbackToken || '');
  if (!owned || !PLAYBACK_TOKEN_FORMAT.test(token)) return res.status(403).json({ ok: false });
  if (film.ageRestricted && !req.session.user.adultConfirmed) return res.status(403).json({ ok: false, reason: 'age' });

  db.prepare("UPDATE users SET active_playback_token = ?, active_playback_at = datetime('now') WHERE user_id = ?")
    .run(token, req.session.user.id);
  res.json({ ok: true });
});

router.post('/film/:id/track-progress', redirectAdminAway, requireLogin, (req, res) => {
  const { viewId, progressSeconds, completed } = req.body;
  // Heartbeat: tell the player whether it is still the account's active device.
  const playbackToken = String(req.body.playbackToken || '');
  const activeRow = db.prepare('SELECT active_playback_token FROM users WHERE user_id = ?').get(req.session.user.id);
  const stillActive = Boolean(playbackToken) && activeRow && activeRow.active_playback_token === playbackToken;
  if (stillActive) {
    db.prepare("UPDATE users SET active_playback_at = datetime('now') WHERE user_id = ?").run(req.session.user.id);
  }

  // Films uploaded before lengths were recorded: the player reports the video's length
  // once, while it is actually streaming, and it is stored for the cards and film page.
  const reportedDuration = parseDuration(req.body.durationSeconds);
  if (stillActive && reportedDuration) {
    db.prepare("UPDATE content SET duration_seconds = ? WHERE content_id = ? AND duration_seconds = 0 AND file_url != ''").run(reportedDuration, Number(req.params.id));
  }

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
  res.json({ active: stillActive });
});

router.post('/film/:id/buy', redirectAdminAway, requireLogin, async (req, res) => {
  const film = getContent(req.params.id);
  if (!film) return renderNotFound(res);

  const { reference } = req.body;
  const { filmReviews, owned, access, canReview } = getFilmDetailContext(film, req.session.user.id);
  if (owned) {
    return res.redirect(`/film/${film.id}`);
  }

  const renderError = error => res.render('film-detail', {
    film, owned, filmReviews, access, canReview, viewId: null, resumeSeconds: 0, resumeCompleted: false, error
  });

  if (film.comingSoon) {
    return renderError("This film isn't available yet. Watch the trailer, and check back soon.");
  }
  if (film.ageRestricted && !req.session.user.adultConfirmed) {
    return renderError('This film is rated 18. Please confirm you are 18 or older before buying it.');
  }

  if (!paystack.isConfigured) {
    console.error('Purchase attempted but Paystack keys are not configured (PAYSTACK_PUBLIC_KEY / PAYSTACK_SECRET_KEY).');
    return renderError('Purchases are temporarily unavailable. Please try again later.');
  }

  if (!reference || typeof reference !== 'string') {
    return renderError('No payment reference received. Please try again.');
  }

  // A Paystack reference can only ever pay for one purchase (also enforced by a unique
  // index) — otherwise one successful payment could be replayed to unlock other films.
  if (db.prepare('SELECT 1 FROM purchases WHERE transaction_ref = ?').get(reference)) {
    return renderError('This payment has already been used for a purchase. If you were charged twice, please contact us.');
  }

  try {
    const result = await paystack.verifyTransaction(reference);
    const tx = result && result.data;
    const expectedAmount = Math.round(film.price * 100);
    const paymentOk = result && result.status && tx
      && tx.status === 'success'
      && tx.amount === expectedAmount
      && String(tx.currency || '').toUpperCase() === paystack.PAYSTACK_CURRENCY.toUpperCase()
      && tx.customer && String(tx.customer.email || '').toLowerCase() === req.session.user.email.toLowerCase();

    if (!paymentOk) {
      return renderError('Payment could not be verified. You have not been charged for this film. Please try again.');
    }

    const auth = tx.authorization || {};
    let purchaseId;
    try {
      purchaseId = db.prepare(`
        INSERT INTO purchases (user_id, content_id, amount_paid, payment_status, transaction_ref, payment_channel, card_brand, card_last4)
        VALUES (?, ?, ?, 'completed', ?, ?, ?, ?)
      `).run(
        req.session.user.id, film.id, film.price, reference,
        tx.channel || null, auth.brand || auth.card_type || null,
        /^\d{4}$/.test(String(auth.last4 || '')) ? String(auth.last4) : null
      ).lastInsertRowid;
    } catch (err) {
      // Two tabs submitting the same reference at once: the unique index catches the second.
      if (String(err.message).includes('UNIQUE')) {
        return renderError('This payment has already been used for a purchase.');
      }
      throw err;
    }
    logActivity('Purchase made', film.title, customerActor(req.session.user.fullName));
    notify(req.session.user.id, 'purchase_confirmation', `Your purchase of "${film.title}" was successful. Enjoy the film! Your receipt has been emailed to you and is also on your Account page.`);

    // The purchase is already saved, so a mail problem must never undo it or show an error.
    const receipt = getReceipt(purchaseId, req.session.user.id);
    sendPurchaseReceipt(receipt).catch(err => console.error(`Receipt email for purchase ${purchaseId} failed:`, err.message));

    res.redirect(`/film/${film.id}`);
  } catch (err) {
    console.error('Paystack verification failed:', err);
    renderError('Could not reach Paystack to verify payment. Please try again.');
  }
});

// Rating (optional, 1–5) and comment (optional) from a review form, or an error message.
function parseReviewInput(body) {
  const ratingRaw = String(body.rating || '').trim();
  const comment = String(body.comment || '').trim();
  const rating = ratingRaw ? Number(ratingRaw) : null;
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) return { error: 'Rating must be between 1 and 5.' };
  if (rating === null && !comment) return { error: 'Please provide a rating, a comment, or both.' };
  if (comment.length > 2000) return { error: 'Please keep your comment under 2000 characters.' };
  if (comment && containsProfanity(comment)) return { error: 'Your comment was not published because it contains inappropriate language. Please rephrase it and try again.', profanity: true };
  return { rating, comment: comment || null };
}

// The logged-in customer's own published review of this film, or null.
function getOwnReview(req, film) {
  return db.prepare("SELECT * FROM feedback WHERE feedback_id = ? AND content_id = ? AND user_id = ? AND status = 'published'")
    .get(Number(req.params.reviewId), film.id, req.session.user.id) || null;
}

router.post('/film/:id/review/:reviewId/edit', redirectAdminAway, requireLogin, (req, res) => {
  const film = getContent(req.params.id);
  if (!film) return renderNotFound(res);
  const review = getOwnReview(req, film);
  if (!review) return renderNotFound(res);

  const input = parseReviewInput(req.body);
  if (input.error) {
    if (input.profanity) logActivity('Comment blocked (inappropriate language)', film.title, customerActor(req.session.user.fullName));
    const ctx = getFilmDetailContext(film, req.session.user.id);
    return res.render('film-detail', { ...ctx, film, viewId: null, resumeSeconds: 0, resumeCompleted: false, error: input.error, editingReviewId: review.feedback_id });
  }
  db.prepare("UPDATE feedback SET rating = ?, comment = ?, edited_at = datetime('now') WHERE feedback_id = ?")
    .run(input.rating, input.comment, review.feedback_id);
  logActivity('Review edited', film.title, customerActor(req.session.user.fullName));
  res.redirect(`/film/${film.id}#review-${review.feedback_id}`);
});

router.post('/film/:id/review/:reviewId/delete', redirectAdminAway, requireLogin, (req, res) => {
  const film = getContent(req.params.id);
  if (!film) return renderNotFound(res);
  const review = getOwnReview(req, film);
  if (!review) return renderNotFound(res);

  db.prepare('DELETE FROM feedback WHERE feedback_id = ?').run(review.feedback_id);
  logActivity('Review deleted by customer', film.title, customerActor(req.session.user.fullName));
  res.redirect(`/film/${film.id}#reviews`);
});

router.post('/film/:id/review', redirectAdminAway, requireLogin, (req, res) => {
  const film = getContent(req.params.id);
  if (!film) return renderNotFound(res);

  const { filmReviews, owned, access, canReview } = getFilmDetailContext(film, req.session.user.id);

  if (!canReview) {
    return res.render('film-detail', { film, owned, filmReviews, access, canReview, viewId: null, resumeSeconds: 0, resumeCompleted: false, error: 'You can only review films you have bought. Buy this film to leave a review.' });
  }

  const input = parseReviewInput(req.body);
  if (input.error) {
    if (input.profanity) logActivity('Comment blocked (inappropriate language)', film.title, customerActor(req.session.user.fullName));
    return res.render('film-detail', { film, owned, filmReviews, access, canReview, viewId: null, resumeSeconds: 0, resumeCompleted: false, error: input.error });
  }

  db.prepare('INSERT INTO feedback (content_id, user_id, rating, comment) VALUES (?, ?, ?, ?)')
    .run(film.id, req.session.user.id, input.rating, input.comment);
  logActivity('Review submitted', film.title, customerActor(req.session.user.fullName));

  res.redirect(`/film/${film.id}`);
});

module.exports = router;
