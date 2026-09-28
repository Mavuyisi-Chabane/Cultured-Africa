// Fixed, hand-authored sample dataset for the admin Reports tab (Revenue & Content,
// User Analytics, Engagement & Behaviour). Every rollup below (totals, sums, insights)
// is *derived* from the same per-film base numbers rather than typed in separately, so
// the three reports always cross-check against each other and against themselves —
// e.g. hourly/daily session buckets always sum to the same Total Sessions figure, and
// "New This Week" always matches the last point on the registration trend line.
//
// Per-film week-by-week history (for the date-range filter and the drill-down trend) and
// individual reviews are derived from these numbers too — see buildFilmHistory().
const { startOfWeek, formatDateRange } = require('../utils/dates');
const { flagLevel } = require('../utils/reportThresholds');

const FILMS = [
  {
    title: 'Echoes of the Highveld', culture: 'Zulu', genre: 'Drama', price: 50, isAvailable: true,
    rating: 4.6,
    weeklyViews: 86, weeklyCompleted: 62, weeklyUnits: 34, weeklyReviewCount: 9, weeklyRatingSum: 41,
    allTimeViews: 612, allTimeUnits: 268, allTimeUniqueViewers: 401, allTimeCompleted: 428, avgWatchSeconds: 2760
  },
  {
    title: 'Ubuntu: The Eternal Bond', culture: 'Xhosa', genre: 'Family', price: 0, isAvailable: true,
    rating: 4.5,
    weeklyViews: 112, weeklyCompleted: 79, weeklyUnits: 0, weeklyReviewCount: 14, weeklyRatingSum: 63,
    allTimeViews: 845, allTimeUnits: 0, allTimeUniqueViewers: 512, allTimeCompleted: 634, avgWatchSeconds: 1980
  },
  {
    title: 'Threads of Venda', culture: 'Venda', genre: 'Documentary', price: 50, isAvailable: true,
    rating: 4.2,
    weeklyViews: 54, weeklyCompleted: 33, weeklyUnits: 21, weeklyReviewCount: 6, weeklyRatingSum: 25,
    allTimeViews: 398, allTimeUnits: 163, allTimeUniqueViewers: 276, allTimeCompleted: 199, avgWatchSeconds: 3120
  },
  {
    title: 'Mountain Guardians', culture: 'Sotho', genre: 'Action', price: 0, isAvailable: true,
    rating: 4.2,
    weeklyViews: 97, weeklyCompleted: 58, weeklyUnits: 0, weeklyReviewCount: 11, weeklyRatingSum: 46,
    allTimeViews: 701, allTimeUnits: 0, allTimeUniqueViewers: 455, allTimeCompleted: 456, avgWatchSeconds: 2340
  },
  {
    title: 'The Rhythm of Tsonga', culture: 'Tsonga', genre: 'Music', price: 50, isAvailable: true,
    rating: 4.3,
    weeklyViews: 63, weeklyCompleted: 39, weeklyUnits: 27, weeklyReviewCount: 8, weeklyRatingSum: 34,
    allTimeViews: 459, allTimeUnits: 204, allTimeUniqueViewers: 312, allTimeCompleted: 312, avgWatchSeconds: 1560
  },
  {
    title: 'City of Gold', culture: 'Multi-Culture', genre: 'Urban Drama', price: 0, isAvailable: true,
    rating: 4.1,
    weeklyViews: 71, weeklyCompleted: 44, weeklyUnits: 0, weeklyReviewCount: 7, weeklyRatingSum: 29,
    allTimeViews: 523, allTimeUnits: 0, allTimeUniqueViewers: 298, allTimeCompleted: 288, avgWatchSeconds: 1860
  }
];

const USER_STATS = { totalUsers: 132, totalCustomers: 124, verifiedUsers: 118, newUsersThisWeek: 9 };
const REGISTRATION_COUNTS = [5, 7, 8, USER_STATS.newUsersThisWeek];
const TREND_VIEWS = [356, 398, 441];

const MOST_ACTIVE_VIEWERS = [
  { full_name: 'Zanele Mthembu', sessions: 47, filmsWatched: 6 },
  { full_name: 'Kagiso Mahlangu', sessions: 39, filmsWatched: 5 },
  { full_name: 'Naledi Sithole', sessions: 33, filmsWatched: 6 },
  { full_name: 'Tumi Radebe', sessions: 28, filmsWatched: 4 },
  { full_name: 'Ayanda Cele', sessions: 22, filmsWatched: 5 }
];

const HOUR_WEIGHTS = [2, 1, 1, 1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 22, 18, 12, 7, 4];
const DAY_WEIGHTS = [16, 10, 9, 9, 10, 13, 18]; // Sun..Sat
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const REVIEWERS = [
  'Zanele Mthembu', 'Kagiso Mahlangu', 'Naledi Sithole', 'Tumi Radebe', 'Ayanda Cele',
  'Sipho Ndlovu', 'Lerato Mokoena', 'Thabo Nkosi', 'Palesa Dlamini', 'Mpho Baloyi',
  'Nomvula Khumalo', 'Bongani Zulu', 'Refilwe Molefe', 'Lwazi Mabaso', 'Karabo Maseko',
  'Nandi Mahlaba', 'Tshepo Mokgadi', 'Ntombi Shabalala', 'Vusi Ngcobo', 'Dineo Mashaba'
];

// Comment pools per star rating. Low ratings name concrete complaints (pacing, length,
// audio) so the drill-down's lowest-first review list explains *why* a film struggles.
const REVIEW_COMMENTS = {
  1: [
    'Stopped watching halfway — the pacing was far too slow for me.',
    'Audio kept dropping out and the subtitles were out of sync.',
    'Did not hold my attention at all. Too long for the story it tells.'
  ],
  2: [
    'Beautiful visuals, but the middle drags and I lost interest.',
    'Hard to follow — the story jumps around without explanation.',
    'Felt much longer than it needed to be. The ending was rushed.'
  ],
  3: [
    'Decent, but the second half loses momentum.',
    'Good performances, though the runtime could be trimmed.',
    'Some strong scenes, but uneven overall. Worth one watch.'
  ],
  4: [
    'Really enjoyed it — a couple of slow moments, but worth it.',
    'Well made and respectful of the culture it portrays.',
    'Great soundtrack and strong performances throughout.'
  ],
  5: [
    'Outstanding. Watched it twice and would again.',
    'Moving and authentic — exactly why I subscribed.',
    'A beautiful story. Recommended it to my whole family.'
  ]
};

const WEEKS_IN_HISTORY = TREND_VIEWS.length + 1; // three past weeks + the current one
const PERIOD_OPTIONS = [
  { weeks: 1, label: 'This week' },
  { weeks: 2, label: 'Last 2 weeks' },
  { weeks: 4, label: 'Last 4 weeks' }
];
const CULTURES = [...new Set(FILMS.map(f => f.culture))].sort();

function round1(n) {
  return Math.round(n * 10) / 10;
}

function sum(items, fn) {
  return items.reduce((s, x) => s + fn(x), 0);
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Seeded PRNG (mulberry32) so the derived history and reviews are identical on every
// request — the reports must not reshuffle between a page view and its PDF export.
function seededRandom(seedText) {
  let state = 2166136261;
  for (const ch of seedText) state = Math.imul(state ^ ch.charCodeAt(0), 16777619);
  return function () {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rand, list) {
  return list[Math.floor(rand() * list.length)];
}

// Splits `total` across `weights` proportionally, rounding to integers that still sum
// to exactly `total` (largest-remainder method) so bucketed charts never drift from
// the headline total they're supposed to add up to.
function distribute(total, weights) {
  const sumW = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map(w => (w / sumW) * total);
  const floors = raw.map(Math.floor);
  let remainder = total - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  const result = floors.slice();
  for (let k = 0; k < remainder; k++) result[order[k].i] += 1;
  return result;
}

function dropOffRisk(completionRate, sessions) {
  if (!sessions) return 'No data';
  return completionRate >= 70 ? 'Low' : completionRate >= 40 ? 'Medium' : 'High';
}

function weekWindows(now) {
  const current = startOfWeek(now);
  return Array.from({ length: WEEKS_IN_HISTORY }, (_, i) => {
    const start = new Date(current);
    start.setDate(start.getDate() - (WEEKS_IN_HISTORY - 1 - i) * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { index: i, label: `Week ${i + 1}`, start, end };
  });
}

// Individual reviews whose star ratings sum to exactly `ratingSum`, so a film's average
// rating in the drill-down always matches the figure in the report table.
function buildReviews(film, win, count, ratingSum, now) {
  if (!count) return [];
  const rand = seededRandom(`${film.title}|reviews|${win.index}`);
  const base = Math.floor(ratingSum / count);
  const extra = ratingSum - base * count;
  const ratings = Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
  // Spread ratings out by moving single stars between reviews — keeps the sum unchanged.
  for (let k = 0; k < count * 2; k++) {
    const i = Math.floor(rand() * count);
    const j = Math.floor(rand() * count);
    if (i !== j && ratings[i] > 1 && ratings[j] < 5) { ratings[i]--; ratings[j]++; }
  }
  // Reviews in the current week are never dated after today.
  const lastDay = Math.max(0, Math.min(6, Math.floor((now - win.start) / 86400000)));
  return ratings.map(rating => {
    const date = new Date(win.start);
    date.setDate(date.getDate() + Math.floor(rand() * (lastDay + 1)));
    return {
      film: film.title, filmSlug: slugify(film.title),
      rating, reviewer: pick(rand, REVIEWERS), comment: pick(rand, REVIEW_COMMENTS[rating]), date
    };
  });
}

// Week-by-week history for every film. The current week is exactly the hand-authored
// weekly figures above; earlier weeks split TREND_VIEWS across films (so the per-film
// trends always add up to the 4-week trend line) with ratios close to this week's.
function buildFilmHistory(now) {
  const windows = weekWindows(now);
  const history = new Map(FILMS.map(f => [f.title, []]));

  windows.forEach((win, w) => {
    const isCurrent = w === windows.length - 1;
    const weightRand = seededRandom(`views|${w}`);
    const viewsPerFilm = isCurrent
      ? FILMS.map(f => f.weeklyViews)
      : distribute(TREND_VIEWS[w], FILMS.map(f => f.weeklyViews * (0.85 + 0.3 * weightRand())));

    FILMS.forEach((f, i) => {
      const views = viewsPerFilm[i];
      let completed, units, reviewCount, ratingSum;
      if (isCurrent) {
        ({ weeklyCompleted: completed, weeklyUnits: units, weeklyReviewCount: reviewCount, weeklyRatingSum: ratingSum } = f);
      } else {
        const rand = seededRandom(`${f.title}|${w}`);
        const rate = Math.min(1, Math.max(0, f.weeklyCompleted / f.weeklyViews + (rand() - 0.5) * 0.1));
        completed = Math.round(views * rate);
        units = Math.round(views * (f.weeklyUnits / f.weeklyViews));
        reviewCount = Math.round(views * (f.weeklyReviewCount / f.weeklyViews));
        const avg = f.weeklyRatingSum / f.weeklyReviewCount + (rand() - 0.5) * 0.3;
        ratingSum = Math.min(reviewCount * 5, Math.max(reviewCount, Math.round(reviewCount * avg)));
      }
      history.get(f.title).push({
        ...win, views, completed, units, revenue: units * f.price,
        reviews: buildReviews(f, win, reviewCount, ratingSum, now)
      });
    });
  });
  return { windows, history };
}

// Rolls a film's last `weeks` weeks of history into the figures the report tables show.
function periodStats(weekRows) {
  const views = sum(weekRows, w => w.views);
  const completed = sum(weekRows, w => w.completed);
  const reviews = weekRows.flatMap(w => w.reviews);
  const ratingSum = sum(reviews, r => r.rating);
  return {
    views, completed,
    units: sum(weekRows, w => w.units),
    revenue: sum(weekRows, w => w.revenue),
    completionRate: views ? Math.round((completed / views) * 100) : 0,
    reviewCount: reviews.length,
    ratingSum,
    avgRating: reviews.length ? round1(ratingSum / reviews.length) : null,
    reviews
  };
}

function trendFor(films, history) {
  return Array.from({ length: WEEKS_IN_HISTORY }, (_, w) => {
    const rows = films.map(f => history.get(f.title)[w]);
    const views = sum(rows, r => r.views);
    const completed = sum(rows, r => r.completed);
    return {
      label: `Week ${w + 1}`, views,
      completionRate: views ? Math.round((completed / views) * 100) : 0
    };
  });
}

function sortReviewsLowestFirst(reviews) {
  return [...reviews].sort((a, b) => a.rating - b.rating || b.date - a.date);
}

// ---------- Filters (date range, culture, "only films with issues") ----------

function parseReportFilters(query = {}) {
  const weeks = PERIOD_OPTIONS.some(p => p.weeks === Number(query.weeks)) ? Number(query.weeks) : 1;
  const culture = CULTURES.includes(query.culture) ? query.culture : '';
  const issuesOnly = query.issues === '1';
  return { weeks, culture, issuesOnly };
}

// Only non-default values, so unfiltered links stay clean (/admin/reports, not ?weeks=1).
function filterQueryString(filters) {
  const params = new URLSearchParams();
  if (filters.weeks !== 1) params.set('weeks', filters.weeks);
  if (filters.culture) params.set('culture', filters.culture);
  if (filters.issuesOnly) params.set('issues', '1');
  return params.toString();
}

function describePeriod(weeks, windows) {
  const slice = windows.slice(-weeks);
  const range = formatDateRange(slice[0].start, slice[slice.length - 1].end);
  return weeks === 1
    ? { label: `Week of ${range}`, phrase: 'this week' }
    : { label: `Last ${weeks} weeks · ${range}`, phrase: `over the last ${weeks} weeks` };
}

// ---------- Report builders ----------

// Revenue & Content share one film selection so both halves of the page always describe
// the same films. A film "has issues" when its rating or completion is flagged.
function buildRevenueContentReport(filters) {
  const now = new Date();
  const { windows, history } = buildFilmHistory(now);
  const period = describePeriod(filters.weeks, windows);

  const films = FILMS
    .filter(f => !filters.culture || f.culture === filters.culture)
    .map(f => ({ film: f, stats: periodStats(history.get(f.title).slice(-filters.weeks)) }))
    .map(x => ({
      ...x,
      flags: { rating: flagLevel('rating', x.stats.avgRating), completion: flagLevel('completion', x.stats.completionRate) }
    }))
    .filter(x => !filters.issuesOnly || x.flags.rating || x.flags.completion);

  const base = x => ({ title: x.film.title, slug: slugify(x.film.title), culture: x.film.culture, cultureSlug: slugify(x.film.culture) });

  const revenueByFilm = films
    .map(x => ({ ...base(x), price: x.film.price, units: x.stats.units, revenue: x.stats.revenue }))
    .sort((a, b) => b.revenue - a.revenue);
  const totalRevenue = sum(revenueByFilm, f => f.revenue);
  const freeFilmWithViews = films
    .filter(x => x.film.price === 0)
    .sort((a, b) => b.stats.views - a.stats.views)
    .map(x => ({ title: x.film.title, views: x.stats.views }))[0] || null;

  const contentByFilm = films
    .map(x => ({
      ...base(x), views: x.stats.views, completionRate: x.stats.completionRate,
      reviewCount: x.stats.reviewCount, avgRating: x.stats.avgRating, flags: x.flags
    }))
    .sort((a, b) => b.views - a.views);
  const totalViews = sum(films, x => x.stats.views);
  const totalCompleted = sum(films, x => x.stats.completed);
  const totalReviews = sum(films, x => x.stats.reviewCount);
  const totalRatingSum = sum(films, x => x.stats.ratingSum);

  const cultureViewMap = {};
  contentByFilm.forEach(f => { cultureViewMap[f.culture] = (cultureViewMap[f.culture] || 0) + f.views; });
  const topCulture = Object.entries(cultureViewMap).sort((a, b) => b[1] - a[1])[0];
  const avgCompletion = totalViews ? Math.round((totalCompleted / totalViews) * 100) : 0;
  const avgRating = totalReviews ? round1(totalRatingSum / totalReviews) : null;

  return {
    period,
    revenueReport: {
      totalRevenue,
      totalUnitsSold: sum(revenueByFilm, f => f.units),
      activeFilms: films.filter(x => x.film.isAvailable).length,
      byFilm: revenueByFilm,
      insights: { topPerformer: revenueByFilm.find(f => f.revenue > 0) || null, freeFilmWithViews }
    },
    contentReport: {
      totalViews, avgCompletion, avgRating, totalReviews,
      flags: { rating: flagLevel('rating', avgRating), completion: flagLevel('completion', avgCompletion) },
      byFilm: contentByFilm,
      trend: trendFor(films.map(x => x.film), history),
      insights: {
        mostViewed: contentByFilm.find(f => f.views > 0) || null,
        highestRated: [...contentByFilm].filter(f => f.avgRating !== null).sort((a, b) => b.avgRating - a.avgRating)[0] || null,
        bestCompletion: [...contentByFilm].filter(f => f.views > 0).sort((a, b) => b.completionRate - a.completionRate)[0] || null,
        topCulture: topCulture ? topCulture[0] : null
      }
    }
  };
}

function cultureAllTime(culture) {
  const films = FILMS.filter(f => f.culture === culture);
  const views = sum(films, f => f.allTimeViews);
  const avgRating = films.length ? round1(sum(films, f => f.rating) / films.length) : null;
  return {
    name: culture, slug: slugify(culture),
    views, revenue: sum(films, f => f.allTimeUnits * f.price), filmCount: films.length, avgRating,
    // Supply relative to demand: a low number means many views per film, i.e. under-served.
    filmsPer1kViews: views ? Math.round((films.length / views) * 100000) / 100 : null,
    flags: { rating: flagLevel('rating', avgRating) }
  };
}

function buildAnalyticsReport() {
  const byGenre = {};
  FILMS.forEach(f => { byGenre[f.genre] = (byGenre[f.genre] || 0) + f.allTimeViews; });

  return {
    byCulture: CULTURES.map(cultureAllTime).sort((a, b) => b.views - a.views),
    byGenre: Object.entries(byGenre).map(([name, views]) => ({ name, views })).sort((a, b) => b.views - a.views),
    userStats: USER_STATS,
    registrationTrend: REGISTRATION_COUNTS.map((count, i) => ({ label: `Week ${i + 1}`, count })),
    mostActiveViewers: MOST_ACTIVE_VIEWERS
  };
}

function allTimeEngagement(f) {
  const completionRate = f.allTimeViews ? Math.round((f.allTimeCompleted / f.allTimeViews) * 100) : 0;
  return {
    title: f.title, slug: slugify(f.title), culture: f.culture, cultureSlug: slugify(f.culture),
    sessions: f.allTimeViews,
    avgWatchSeconds: f.avgWatchSeconds,
    completionRate,
    repeatRate: f.allTimeViews ? Math.round(((f.allTimeViews - f.allTimeUniqueViewers) / f.allTimeViews) * 100) : 0,
    dropOffRisk: dropOffRisk(completionRate, f.allTimeViews),
    flags: { completion: f.allTimeViews ? flagLevel('completion', completionRate) : null }
  };
}

// All-time, so there is no date range here; culture and "issues only" still apply, and
// every headline figure and chart is recomputed from the films left after filtering.
function buildEngagementReport(filters) {
  const films = FILMS
    .filter(f => !filters.culture || f.culture === filters.culture)
    .filter(f => !filters.issuesOnly || allTimeEngagement(f).flags.completion);

  const totalSessions = sum(films, f => f.allTimeViews);
  const viewsByHour = distribute(totalSessions, HOUR_WEIGHTS).map((views, hour) => ({ hour, views }));
  const dayCounts = distribute(totalSessions, DAY_WEIGHTS);
  const viewsByDay = DAY_NAMES.map((day, i) => ({ day, views: dayCounts[i] }));

  const uniquePairs = sum(films, f => f.allTimeUniqueViewers);
  const repeatViewRate = totalSessions ? Math.round(((totalSessions - uniquePairs) / totalSessions) * 100) : 0;

  const peakHour = [...viewsByHour].sort((a, b) => b.views - a.views)[0];
  const peakDay = [...viewsByDay].sort((a, b) => b.views - a.views)[0];

  const engagementByFilm = films.map(allTimeEngagement).sort((a, b) => b.sessions - a.sessions);
  const mostRewatched = [...engagementByFilm].filter(f => f.sessions > 0).sort((a, b) => b.repeatRate - a.repeatRate)[0] || null;
  const highestDropOff = [...engagementByFilm].filter(f => f.sessions > 0).sort((a, b) => a.completionRate - b.completionRate)[0] || null;

  return {
    viewsByHour, viewsByDay, totalSessions, repeatViewRate, peakHour, peakDay,
    engagementByFilm, insights: { mostRewatched, highestDropOff }
  };
}

// ---------- Drill-down detail views ----------

function buildFilmDetail(slug, filters) {
  const film = FILMS.find(f => slugify(f.title) === slug);
  if (!film) return null;
  const now = new Date();
  const { windows, history } = buildFilmHistory(now);
  const stats = periodStats(history.get(film.title).slice(-filters.weeks));
  const allTime = allTimeEngagement(film);

  return {
    kind: 'film',
    name: film.title,
    slug,
    period: describePeriod(filters.weeks, windows),
    film: {
      title: film.title, culture: film.culture, cultureSlug: slugify(film.culture),
      genre: film.genre, price: film.price, allTimeRating: film.rating
    },
    stats: {
      ...stats,
      flags: { rating: flagLevel('rating', stats.avgRating), completion: flagLevel('completion', stats.completionRate) }
    },
    allTime,
    trend: trendFor([film], history),
    reviews: sortReviewsLowestFirst(stats.reviews)
  };
}

function buildCultureDetail(slug, filters) {
  const culture = CULTURES.find(c => slugify(c) === slug);
  if (!culture) return null;
  const now = new Date();
  const { windows, history } = buildFilmHistory(now);
  const cultureFilms = FILMS.filter(f => f.culture === culture);

  const films = cultureFilms.map(f => {
    const stats = periodStats(history.get(f.title).slice(-filters.weeks));
    return {
      title: f.title, slug: slugify(f.title), genre: f.genre, price: f.price,
      views: stats.views, completionRate: stats.completionRate, avgRating: stats.avgRating,
      reviewCount: stats.reviewCount, revenue: stats.revenue, reviews: stats.reviews,
      flags: { rating: flagLevel('rating', stats.avgRating), completion: flagLevel('completion', stats.completionRate) }
    };
  });

  const views = sum(films, f => f.views);
  const completed = sum(cultureFilms, f => sum(history.get(f.title).slice(-filters.weeks), w => w.completed));
  const reviews = films.flatMap(f => f.reviews);
  const completionRate = views ? Math.round((completed / views) * 100) : 0;
  const avgRating = reviews.length ? round1(sum(reviews, r => r.rating) / reviews.length) : null;

  return {
    kind: 'culture',
    name: culture,
    slug,
    period: describePeriod(filters.weeks, windows),
    stats: {
      views, completionRate, avgRating, reviewCount: reviews.length, revenue: sum(films, f => f.revenue),
      flags: { rating: flagLevel('rating', avgRating), completion: flagLevel('completion', completionRate) }
    },
    allTime: cultureAllTime(culture),
    films: films.sort((a, b) => b.views - a.views),
    trend: trendFor(cultureFilms, history),
    reviews: sortReviewsLowestFirst(reviews)
  };
}

module.exports = {
  PERIOD_OPTIONS, CULTURES,
  parseReportFilters, filterQueryString,
  buildRevenueContentReport, buildAnalyticsReport, buildEngagementReport,
  buildFilmDetail, buildCultureDetail
};
