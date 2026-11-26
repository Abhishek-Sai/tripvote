const { countInstantRunoff } = require('./irv');
const { isUuid } = require('./validate');

// Counts the trip's ballots. Works with db or a transaction (anything with query).
async function countTrip(q, tripId) {
  const { rows: options } = await q.query(
    'select destination_id, name, created_at from destinations where trip_id = $1',
    [tripId],
  );
  const { rows: ballots } = await q.query(
    'select ordered_destination_ids from ballots where trip_id = $1',
    [tripId],
  );
  const result = countInstantRunoff(
    options.map((o) => ({ id: o.destination_id, createdAt: o.created_at })),
    ballots.map((b) => b.ordered_destination_ids),
  );
  return { ...result, options, ballotCount: ballots.length };
}

// Closes an open poll and stores the outcome (FR-11, FR-13, FR-14, FR-29).
// The caller must hold the trip row lock (FOR UPDATE) inside a transaction.
async function closeAndCount(tx, tripId) {
  const result = await countTrip(tx, tripId);
  const status = result.outcome === 'tie' ? 'tie' : 'closed';
  await tx.query(
    'update trips set status = $2, winner_id = $3 where trip_id = $1',
    [tripId, status, result.winnerId],
  );
  return { status, winnerId: result.winnerId };
}

// FR-28: close the poll once server time reaches the deadline. Runs before
// every trip request, so the poll is closed by the time anyone looks at it,
// without a background job (the API runs as a serverless function).
async function closeIfDeadlinePassed(db, tripId) {
  if (!isUuid(tripId)) return;
  const { rows } = await db.query(
    `select 1 from trips
      where trip_id = $1 and status = 'open' and deadline <= now()`,
    [tripId],
  );
  if (rows.length === 0) return;

  await db.transaction(async (tx) => {
    // Check again under the lock: another request may have closed it already.
    const locked = await tx.query(
      `select 1 from trips
        where trip_id = $1 and status = 'open' and deadline <= now()
        for update`,
      [tripId],
    );
    if (locked.rows.length > 0) await closeAndCount(tx, tripId);
  });
}

module.exports = { countTrip, closeAndCount, closeIfDeadlinePassed };
