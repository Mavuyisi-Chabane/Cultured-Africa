// South African Film and Publication Board (FPB) age classifications and consumer
// advice. Admins pick one rating (required) and any advisories when uploading a film;
// the badge partial (views/partials/age-rating.ejs) renders them everywhere a film shows.
// X18 / XX are deliberately absent — that content isn't distributed on this platform.
const AGE_RATINGS = [
  { code: 'A', label: 'All ages', description: 'Suitable for all ages.', color: '#2f7d32' },
  { code: 'PG', label: 'Parental guidance', description: 'Parental guidance is advised for young viewers.', color: '#2f7d32' },
  { code: '7-9PG', label: '7–9 with parental guidance', description: 'Not suitable for children under 7. Children aged 7 to 9 may watch with parental guidance.', color: '#8a6d00' },
  { code: '10-12PG', label: '10–12 with parental guidance', description: 'Not suitable for children under 10. Children aged 10 to 12 may watch with parental guidance.', color: '#8a6d00' },
  { code: '13', label: '13 and older', description: 'Not suitable for viewers under 13.', color: '#b24a00' },
  { code: '16', label: '16 and older', description: 'Not suitable for viewers under 16.', color: '#b3261e' },
  { code: '18', label: '18 and older', description: 'Not suitable for viewers under 18.', color: '#8c1414' }
];

const CONTENT_ADVISORIES = [
  { code: 'V', label: 'Violence' },
  { code: 'L', label: 'Language' },
  { code: 'N', label: 'Nudity' },
  { code: 'S', label: 'Sex' },
  { code: 'D', label: 'Drug use' },
  { code: 'P', label: 'Prejudice' },
  { code: 'H', label: 'Horror' }
];

const RATINGS_BY_CODE = new Map(AGE_RATINGS.map(r => [r.code, r]));
const ADVISORIES_BY_CODE = new Map(CONTENT_ADVISORIES.map(a => [a.code, a]));

// Stored as content.age_rating (a code, or NULL for films uploaded before ratings
// existed) and content.content_advisories (codes joined with commas, e.g. "V,L").
function describeRating(code, advisoriesCsv) {
  const rating = RATINGS_BY_CODE.get(code) || null;
  const advisories = String(advisoriesCsv || '').split(',').map(c => ADVISORIES_BY_CODE.get(c)).filter(Boolean);
  return { rating, advisories };
}

// Validates form input: returns { code, advisoriesCsv } or { error }.
function parseRatingInput(body) {
  const rating = RATINGS_BY_CODE.get(body.ageRating);
  if (!rating) return { error: 'Please choose an age rating for this film.' };
  const picked = [].concat(body.advisories || []);
  const advisoriesCsv = CONTENT_ADVISORIES.filter(a => picked.includes(a.code)).map(a => a.code).join(',');
  return { code: rating.code, advisoriesCsv };
}

module.exports = { AGE_RATINGS, CONTENT_ADVISORIES, describeRating, parseRatingInput };
