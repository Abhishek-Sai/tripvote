require('dotenv').config({ quiet: true });
const { createApp } = require('./app');
const { createPgDb } = require('./lib/db');

const port = process.env.PORT || 3001;
const db = process.env.DATABASE_URL ? createPgDb(process.env.DATABASE_URL) : null;

if (!db) console.warn('DATABASE_URL is not set: trip APIs will return 503.');

createApp({ db }).listen(port, () => {
  console.log(`TripVote API listening on http://localhost:${port}`);
});
