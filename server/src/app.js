const cors = require('cors');
const express = require('express');
const { ApiError } = require('./lib/errors');
const { healthRouter } = require('./routes/health');
const { tripsRouter } = require('./routes/trips');

// db: the database interface from lib/db.js, or null when not configured.
function createApp({ db = null } = {}) {
  const app = express();

  app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
  app.use(express.json({ limit: '10kb' }));

  app.use('/api/health', healthRouter(db));

  if (db) {
    app.use('/api/trips', tripsRouter(db));
  } else {
    app.use('/api', (req, res) => {
      res.status(503).json({ error: { code: 'db_unavailable', message: 'Database is not configured' } });
    });
  }

  app.use((req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Not found' } });
  });

  app.use(errorHandler);

  return app;
}

// Never echo internal errors or request bodies: they may hold tokens (FR-09).
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'invalid_json', message: 'Body must be valid JSON' } });
  }
  console.error('Unhandled error:', err.code || err.name, err.message);
  return res.status(500).json({ error: { code: 'internal', message: 'Something went wrong' } });
}

module.exports = { createApp, errorHandler };
