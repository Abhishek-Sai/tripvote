const { Pool } = require('pg');

// Every route talks to the database through this small interface:
//   query(sql, params)      -> { rows }
//   transaction(async (tx) => { await tx.query(...) })
// Production uses a pg Pool against Supabase's pooler; tests use PGlite.

// ssl: from buildSslConfig() in lib/dbSsl.js.
function createPgDb(connectionString, ssl) {
  const pool = new Pool({ connectionString, ssl, max: 5 });

  return {
    query: (sql, params) => pool.query(sql, params),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await fn({ query: (sql, params) => client.query(sql, params) });
        await client.query('commit');
        return result;
      } catch (err) {
        await client.query('rollback');
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

// Wraps a PGlite instance so tests can use the same interface.
function createPgliteDb(pglite) {
  return {
    query: (sql, params) => pglite.query(sql, params),
    transaction: (fn) => pglite.transaction((tx) => fn({ query: (sql, params) => tx.query(sql, params) })),
    close: () => pglite.close(),
  };
}

module.exports = { createPgDb, createPgliteDb };
