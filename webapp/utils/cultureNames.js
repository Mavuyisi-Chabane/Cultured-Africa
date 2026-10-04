const { containsProfanity } = require('./profanityFilter');

// One set of rules for culture names, used by the upload form's "Other" option and the
// Cultures admin page alike.
const MAX_CULTURE_NAME_LENGTH = 50;

// Returns { name } (tidied: trimmed, single spaces) or { error }.
function validateCultureName(raw) {
  const name = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!name) return { error: 'Please type the name of the culture.' };
  if (name.length > MAX_CULTURE_NAME_LENGTH) {
    return { error: `Culture names must be ${MAX_CULTURE_NAME_LENGTH} characters or fewer.` };
  }
  if (!/^\p{L}[\p{L}\p{M}' -]*$/u.test(name)) {
    return { error: 'Culture names may only contain letters, spaces, hyphens and apostrophes.' };
  }
  if (containsProfanity(name)) return { error: 'Please choose a different culture name.' };
  return { name };
}

module.exports = { validateCultureName, MAX_CULTURE_NAME_LENGTH };
