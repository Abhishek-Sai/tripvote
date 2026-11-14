const { createApp } = require('../../src/app');
const { createPgliteDb } = require('../../src/lib/db');
const { createTestDb } = require('../db/testDb');

// The real Express app on top of a fresh in-memory database with all migrations.
async function createTestApp() {
  const t = await createTestDb();
  const db = createPgliteDb(t.db);
  return { app: createApp({ db }), db, t, close: () => t.close() };
}

module.exports = { createTestApp };
