require('dotenv').config({ quiet: true });
const { createApp } = require('./app');
const { createPgDb } = require('./lib/db');
const { buildSslConfig } = require('./lib/dbSsl');

const port = process.env.PORT || 3001;

let db = null;
if (process.env.DATABASE_URL) {
  const { ssl, verified, warning } = buildSslConfig();
  if (warning) console.warn(warning);
  if (verified) console.log('Database TLS certificate verification is on.');
  db = createPgDb(process.env.DATABASE_URL, ssl);
} else {
  console.warn('DATABASE_URL is not set: trip APIs will return 503.');
}

createApp({ db }).listen(port, () => {
  console.log(`TripVote API listening on http://localhost:${port}`);
});
