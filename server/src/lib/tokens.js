const crypto = require('crypto');

// 32 random bytes: unguessable, URL-safe (FR-31).
function generateToken() {
  return crypto.randomBytes(32).toString('base64url');
}

// Tokens are high-entropy, so a fast hash is enough and lets us look rows up
// by hash. Only the hash is stored (SRS section 3.7).
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = { generateToken, hashToken };
