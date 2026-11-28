// Local development server. On Vercel, api/index.js serves the same app.
require('dotenv').config({ quiet: true });
const { createApp } = require('./app');
const { createDbFromEnv } = require('./dbFromEnv');

const port = process.env.PORT || 3001;

createApp({ db: createDbFromEnv() }).listen(port, () => {
  console.log(`TripVote API listening on http://localhost:${port}`);
});
