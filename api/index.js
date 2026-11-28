// Vercel serverless function: the whole Express API (SRS 3.2.3).
// vercel.json sends every /api/* request here; Express routes it as usual.
// The database connection is created once per instance and reused.
const { createApp } = require('../server/src/app');
const { createDbFromEnv } = require('../server/src/dbFromEnv');

module.exports = createApp({ db: createDbFromEnv() });
