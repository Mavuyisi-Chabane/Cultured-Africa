const crypto = require('crypto');
const { db } = require('../db');
const { toSqlDateTime } = require('./dates');

const TOKEN_TTL_MS = 15 * 60 * 1000; // exactly 15 minutes
const CODE_LENGTH = 6;

function generateVerificationCode() {
  // crypto.randomInt is CSPRNG-backed (uses the OS random source), not Math.random.
  // 6 digits = 1,000,000 possible codes; combined with expiry + single-use + the
  // rate limit on verification attempts, this is a safe space for a short-lived code.
  const max = 10 ** CODE_LENGTH;
  return String(crypto.randomInt(0, max)).padStart(CODE_LENGTH, '0');
}

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

// Invalidates any previously-issued, still-unused code for this user and issues a
// fresh one with its own 15-minute expiry — used for both initial registration and
// "resend verification email" (resending must never just extend the old code's life).
function issueVerificationToken(userId) {
  db.prepare('UPDATE email_verification_tokens SET used = 1 WHERE user_id = ? AND used = 0').run(userId);

  const code = generateVerificationCode();
  const tokenHash = hashToken(code);
  const expiresAt = toSqlDateTime(new Date(Date.now() + TOKEN_TTL_MS));

  db.prepare('INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)')
    .run(userId, tokenHash, expiresAt);

  return code;
}

module.exports = { issueVerificationToken, hashToken, TOKEN_TTL_MS };
