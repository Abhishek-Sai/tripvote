const { createPgDb } = require('./lib/db');
const { buildSslConfig } = require('./lib/dbSsl');

// Builds the database connection from DATABASE_URL, shared by the local
// server (src/index.js) and the Vercel function (api/index.js).
// Returns null when DATABASE_URL is not set, so trip APIs answer 503.
function createDbFromEnv(env = process.env) {
  if (!env.DATABASE_URL) {
    console.warn('DATABASE_URL is not set: trip APIs will return 503.');
    return null;
  }
  const { ssl, verified, warning } = buildSslConfig({ env });
  if (warning) console.warn(warning);
  if (verified) console.log('Database TLS certificate verification is on.');
  // A serverless instance handles few requests at once, so it needs fewer
  // connections; Supabase's transaction pooler (port 6543) shares them.
  const max = Number(env.DATABASE_POOL_MAX) || 5;
  return createPgDb(env.DATABASE_URL, ssl, { max });
}

module.exports = { createDbFromEnv };
