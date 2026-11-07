// Spins up an in-memory Postgres (PGlite), applies every migration in
// supabase/migrations in order, and returns helpers for writing tests.
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');

const MIGRATIONS_DIR = path.join(__dirname, '../../../supabase/migrations');

// Supabase creates these roles itself. Locally we imitate them so the
// migrations' grants and revokes apply. service_role is the API's key.
const SUPABASE_ROLES = `
  create role anon;
  create role authenticated;
  create role service_role bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
`;

async function createTestDb() {
  const db = new PGlite();
  await db.exec(SUPABASE_ROLES);

  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    await db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
  }

  // Run tests as the API would.
  await db.exec('set role service_role');

  let counter = 0;
  const rows = async (sql, params) => (await db.query(sql, params)).rows;
  const one = async (sql, params) => (await rows(sql, params))[0];

  const createTrip = (name = 'Test trip') =>
    one('insert into trips (name) values ($1) returning *', [name]);

  const createMember = (tripId, displayName = `Member ${++counter}`, organizer = false) =>
    one(
      `insert into members (trip_id, display_name, token_hash, organizer_flag)
       values ($1, $2, $3, $4) returning *`,
      [tripId, displayName, `hash-${++counter}`, organizer],
    );

  const createDestination = (tripId, name, createdBy = null, note = null) =>
    one(
      `insert into destinations (trip_id, name, created_by, note)
       values ($1, $2, $3, $4) returning *`,
      [tripId, name, createdBy, note],
    );

  const createBallot = (tripId, memberId, destinationIds) =>
    one(
      `insert into ballots (trip_id, member_id, ordered_destination_ids)
       values ($1, $2, $3) returning *`,
      [tripId, memberId, destinationIds],
    );

  const createItem = (tripId, fields = {}) =>
    one(
      `insert into itinerary_items (trip_id, title, starts_at, description, created_by)
       values ($1, $2, $3, $4, $5) returning *`,
      [
        tripId,
        fields.title ?? 'Visit',
        fields.startsAt ?? '2026-12-12T08:00:00Z',
        fields.description ?? null,
        fields.createdBy ?? null,
      ],
    );

  return {
    db,
    rows,
    one,
    createTrip,
    createMember,
    createDestination,
    createBallot,
    createItem,
    close: () => db.close(),
  };
}

module.exports = { createTestDb };
