const crypto = require('crypto');
const { hashToken } = require('./verification');

// Same shape as the customer email-verification codes (utils/verification.js):
// a 6-digit CSPRNG code, hashed before storage, 15-minute expiry.
const INVITE_TTL_MS = 15 * 60 * 1000;
const MAX_INVITE_ATTEMPTS = 5;

function generateInviteCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

module.exports = { generateInviteCode, hashInviteCode: hashToken, INVITE_TTL_MS, MAX_INVITE_ATTEMPTS };
