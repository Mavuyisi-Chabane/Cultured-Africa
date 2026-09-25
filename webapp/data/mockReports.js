// Fixed, hand-authored sample dataset for the admin Reports tab (Revenue & Content,
// User Analytics, Engagement & Behaviour). Every rollup below (totals, sums, insights)
// is *derived* from the same per-film base numbers rather than typed in separately, so
// the three reports always cross-check against each other and against themselves —
// e.g. hourly/daily session buckets always sum to the same Total Sessions figure, and
// "New This Week" always matches the last point on the registration trend line.
const { startOfWeek, endOfWeek, formatWeekLabel } = require('../utils/dates');

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

function round1(n) {
  return Math.round(n * 10) / 10;
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

function buildRevenueReport() {
  const now = new Date();
  const weekLabel = formatWeekLabel(startOfWeek(now), endOfWeek(now));

  const byFilm = FILMS.map(f => ({
    title: f.title, culture: f.culture, price: f.price,
    units: f.weeklyUnits, revenue: f.weeklyUnits * f.price
  })).sort((a, b) => b.revenue - a.revenue);

  const totalRevenue = byFilm.reduce((s, f) => s + f.revenue, 0);
  const totalUnitsSold = byFilm.reduce((s, f) => s + f.units, 0);
  const activeFilms = FILMS.filter(f => f.isAvailable).length;
  const topPerformer = byFilm.find(f => f.revenue > 0) || null;
  const freeFilmWithViews = FILMS
    .filter(f => f.price === 0)
    .map(f => ({ title: f.title, views: f.weeklyViews }))
    .sort((a, b) => b.views - a.views)[0] || null;

  return { weekLabel, totalRevenue, totalUnitsSold, activeFilms, byFilm, insights: { topPerformer, freeFilmWithViews } };
}

function buildContentReport() {
  const now = new Date();
  const weekLabel = formatWeekLabel(startOfWeek(now), endOfWeek(now));

  const byFilm = FILMS.map(f => ({
    title: f.title, culture: f.culture,
    views: f.weeklyViews,
    completionRate: f.weeklyViews ? Math.round((f.weeklyCompleted / f.weeklyViews) * 100) : 0,
    reviewCount: f.weeklyReviewCount,
    avgRating: f.weeklyReviewCount ? round1(f.weeklyRatingSum / f.weeklyReviewCount) : null
  })).sort((a, b) => b.views - a.views);

  const totalViews = byFilm.reduce((s, f) => s + f.views, 0);
  const totalCompleted = FILMS.reduce((s, f) => s + f.weeklyCompleted, 0);
  const avgCompletion = totalViews ? Math.round((totalCompleted / totalViews) * 100) : 0;
  const totalReviews = byFilm.reduce((s, f) => s + f.reviewCount, 0);
  const totalRatingSum = FILMS.reduce((s, f) => s + f.weeklyRatingSum, 0);
  const avgRating = totalReviews ? round1(totalRatingSum / totalReviews) : null;

  const trend = [...TREND_VIEWS, totalViews].map((views, i) => ({ label: `Week ${i + 1}`, views }));

  const mostViewed = byFilm.find(f => f.views > 0) || null;
  const highestRated = [...byFilm].filter(f => f.avgRating !== null).sort((a, b) => b.avgRating - a.avgRating)[0] || null;
  const bestCompletion = [...byFilm].filter(f => f.views > 0).sort((a, b) => b.completionRate - a.completionRate)[0] || null;
  const cultureViewMap = {};
  byFilm.forEach(f => { cultureViewMap[f.culture] = (cultureViewMap[f.culture] || 0) + f.views; });
  const topCulture = Object.entries(cultureViewMap).sort((a, b) => b[1] - a[1])[0];

  return {
    weekLabel, totalViews, avgCompletion, avgRating, totalReviews, byFilm, trend,
    insights: { mostViewed, highestRated, bestCompletion, topCulture: topCulture ? topCulture[0] : null }
  };
}

function buildAnalyticsReport() {
  function groupBy(key) {
    const map = {};
    FILMS.forEach(f => {
      const k = f[key];
      if (!map[k]) map[k] = { views: 0, revenue: 0, filmCount: 0, ratingSum: 0, ratingCount: 0 };
      map[k].views += f.allTimeViews;
      map[k].revenue += f.allTimeUnits * f.price;
      map[k].filmCount += 1;
      map[k].ratingSum += f.rating;
      map[k].ratingCount += 1;
    });
    return Object.entries(map)
      .map(([name, v]) => ({
        name, views: v.views, revenue: v.revenue, filmCount: v.filmCount,
        avgRating: v.ratingCount ? round1(v.ratingSum / v.ratingCount) : null
      }))
      .sort((a, b) => b.views - a.views);
  }

  const registrationTrend = REGISTRATION_COUNTS.map((count, i) => ({ label: `Week ${i + 1}`, count }));

  return {
    byCulture: groupBy('culture'),
    byGenre: groupBy('genre'),
    userStats: USER_STATS,
    registrationTrend,
    mostActiveViewers: MOST_ACTIVE_VIEWERS
  };
}

function buildEngagementReport() {
  const totalSessions = FILMS.reduce((s, f) => s + f.allTimeViews, 0);

  const hourCounts = distribute(totalSessions, HOUR_WEIGHTS);
  const viewsByHour = hourCounts.map((views, hour) => ({ hour, views }));

  const dayCounts = distribute(totalSessions, DAY_WEIGHTS);
  const viewsByDay = DAY_NAMES.map((day, i) => ({ day, views: dayCounts[i] }));

  const uniquePairs = FILMS.reduce((s, f) => s + f.allTimeUniqueViewers, 0);
  const repeatViewRate = totalSessions ? Math.round(((totalSessions - uniquePairs) / totalSessions) * 100) : 0;

  const peakHour = [...viewsByHour].sort((a, b) => b.views - a.views)[0];
  const peakDay = [...viewsByDay].sort((a, b) => b.views - a.views)[0];

  const engagementByFilm = FILMS.map(f => {
    const completionRate = f.allTimeViews ? Math.round((f.allTimeCompleted / f.allTimeViews) * 100) : 0;
    const repeatRate = f.allTimeViews ? Math.round(((f.allTimeViews - f.allTimeUniqueViewers) / f.allTimeViews) * 100) : 0;
    return {
      title: f.title,
      sessions: f.allTimeViews,
      avgWatchSeconds: f.avgWatchSeconds,
      completionRate,
      repeatRate,
      dropOffRisk: f.allTimeViews === 0 ? 'No data' : completionRate >= 70 ? 'Low' : completionRate >= 40 ? 'Medium' : 'High'
    };
  }).sort((a, b) => b.sessions - a.sessions);

  const mostRewatched = [...engagementByFilm].filter(f => f.sessions > 0).sort((a, b) => b.repeatRate - a.repeatRate)[0] || null;
  const highestDropOff = [...engagementByFilm].filter(f => f.sessions > 0).sort((a, b) => a.completionRate - b.completionRate)[0] || null;

  return {
    viewsByHour, viewsByDay, totalSessions, repeatViewRate, peakHour, peakDay,
    engagementByFilm, insights: { mostRewatched, highestDropOff }
  };
}

module.exports = { buildRevenueReport, buildContentReport, buildAnalyticsReport, buildEngagementReport };
