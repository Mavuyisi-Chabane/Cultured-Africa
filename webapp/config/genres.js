// Genres admins choose from on the upload/edit form (stored in content.content_type).
// Films uploaded before genres existed are 'Uncategorized' and show no genre to viewers.
const GENRES = [
  'Drama',
  'Documentary',
  'Music & Dance',
  'Family',
  'Comedy',
  'Romance',
  'Historical',
  'Action',
  'Animation',
  'Short Film',
  'Other'
];

const UNSET_GENRES = new Set(['', 'Uncategorized', 'Film']);

// The genre to show viewers, or '' when none has been chosen yet.
function genreLabel(value) {
  return UNSET_GENRES.has(String(value || '')) ? '' : value;
}

// Film length for display: "14 min", "1 h 12 min"; '' when unknown.
function durationLabel(seconds) {
  const s = Number(seconds) || 0;
  if (s < 30) return '';
  const totalMinutes = Math.max(1, Math.round(s / 60));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// A duration sent by the browser (from the video's own metadata): whole seconds,
// between 1 second and 24 hours, or null if missing/implausible.
function parseDuration(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 1 && n <= 24 * 60 * 60 ? n : null;
}

module.exports = { GENRES, genreLabel, durationLabel, parseDuration };
