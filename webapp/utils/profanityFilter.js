// Small, maintainable blocklist for a student project — not a substitute for a real
// moderation service, but enough to catch clearly vulgar language before it's published.
// Matched as whole words (case-insensitive) so it won't flag substrings inside
// innocent words (e.g. "class", "assess", "Scunthorpe").
const BLOCKED_WORDS = [
  'fuck', 'fucking', 'fucker', 'motherfucker',
  'shit', 'bullshit', 'shitty',
  'bitch', 'bastard',
  'asshole', 'dumbass', 'jackass',
  'cunt', 'dick', 'dickhead', 'piss', 'pissed',
  'whore', 'slut', 'douchebag',
  'nigger', 'nigga', 'faggot', 'retard', 'retarded'
];

const BLOCKED_REGEX = new RegExp(`\\b(${BLOCKED_WORDS.join('|')})\\b`, 'i');

function containsProfanity(text) {
  return BLOCKED_REGEX.test(text || '');
}

module.exports = { containsProfanity };
