const crypto = require('crypto');
const { db } = require('../db');
const { toSqlDateTime } = require('./dates');
const { hashToken } = require('./verification');

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // exactly 30 minutes

function generateRawToken() {
  // 256 bits from the OS CSPRNG — cryptographically secure and unguessable.
  return crypto.randomBytes(32).toString('hex');
}

// Invalidates any previously-issued, still-active reset token for this user and issues
// a fresh one with its own 30-minute expiry — a new request never just extends an old
// token's life, and only one reset token can ever be valid for a user at a time.
function issuePasswordResetToken(userId) {
  db.prepare("UPDATE password_reset_tokens SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL")
    .run(userId);

  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = toSqlDateTime(new Date(Date.now() + RESET_TOKEN_TTL_MS));

  db.prepare('INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)')
    .run(userId, tokenHash, expiresAt);

  return rawToken;
}

module.exports = { issuePasswordResetToken, RESET_TOKEN_TTL_MS };
