const { Router } = require('express');
const { ApiError, badRequest } = require('../lib/errors');
const { isUuid, requiredText } = require('../lib/validate');
const { requireMember, requireOrganizer } = require('../middleware/auth');

const pollClosed = () =>
  new ApiError(409, 'poll_closed', 'Voting has been closed for this trip.');

// Locks the trip row for the rest of the transaction and checks the poll is
// open. FOR SHARE lets members add options and vote at the same time, but makes
// a concurrent "Close poll" wait, so nothing slips in after closing.
async function requireOpenPoll(tx, tripId) {
  const { rows } = await tx.query('select status from trips where trip_id = $1 for share', [tripId]);
  if (rows.length === 0 || rows[0].status !== 'open') throw pollClosed();
}

function optionalNote(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw badRequest('note must be text');
  const trimmed = value.trim();
  if (trimmed.length > 200) throw badRequest('note must be at most 200 characters');
  return trimmed === '' ? null : trimmed;
}

function formatDestination(row) {
  return {
    destinationId: row.destination_id,
    name: row.name,
    note: row.note,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

// Destinations and closing the poll. Every route needs a member token.
function pollRouter(db) {
  const router = Router();
  const member = requireMember(db);

  // FR-05: the trip's destination options, oldest first.
  router.get('/:tripId/destinations', member, async (req, res) => {
    const { rows } = await db.query(
      `select destination_id, name, note, created_at
         from destinations
        where trip_id = $1
        order by created_at, destination_id`,
      [req.params.tripId],
    );
    res.json({ destinations: rows.map(formatDestination) });
  });

  // FR-05 / FR-06: add a destination while the poll is open.
  router.post('/:tripId/destinations', member, async (req, res) => {
    const { tripId } = req.params;
    const name = requiredText(req.body?.name, 'name', 60);
    const note = optionalNote(req.body?.note);

    const destination = await db.transaction(async (tx) => {
      await requireOpenPoll(tx, tripId);

      // FR-06: same name after trimming, ignoring case, is a duplicate.
      const existing = await tx.query(
        'select destination_id from destinations where trip_id = $1 and lower(name) = lower($2)',
        [tripId, name],
      );
      if (existing.rows.length > 0) throw duplicate(existing.rows[0].destination_id);

      try {
        const { rows } = await tx.query(
          `insert into destinations (trip_id, name, note, created_by)
           values ($1, $2, $3, $4)
           returning destination_id, name, note, created_at`,
          [tripId, name, note, req.member.memberId],
        );
        return rows[0];
      } catch (err) {
        // Someone added the same name a moment ago.
        if (err.code === '23505' && err.constraint === 'destinations_unique_name_per_trip') {
          throw duplicate(null);
        }
        throw err;
      }
    });

    res.status(201).json({ destination: formatDestination(destination) });
  });

  // Organizer removes a destination while the poll is open. The database drops
  // it from every ballot, so later ranks move up.
  router.delete('/:tripId/destinations/:destinationId', member, requireOrganizer, async (req, res) => {
    const { tripId, destinationId } = req.params;
    if (!isUuid(destinationId)) throw destinationNotFound();

    await db.transaction(async (tx) => {
      await requireOpenPoll(tx, tripId);
      const { rowCount } = await tx.query(
        'delete from destinations where destination_id = $1 and trip_id = $2',
        [destinationId, tripId],
      );
      if (!rowCount) throw destinationNotFound();
    });

    res.status(204).end();
  });

  // FR-11: the organizer closes the poll. Counting the results is T5.
  router.post('/:tripId/close', member, requireOrganizer, async (req, res) => {
    const { rows } = await db.query(
      `update trips set status = 'closed'
        where trip_id = $1 and status = 'open'
        returning status`,
      [req.params.tripId],
    );
    if (rows.length === 0) {
      throw new ApiError(409, 'poll_not_open', 'The poll is already closed.');
    }
    res.json({ status: 'closed' });
  });

  return router;
}

function duplicate(existingDestinationId) {
  return new ApiError(409, 'duplicate_destination', 'That destination is already an option.', {
    existingDestinationId,
  });
}

function destinationNotFound() {
  return new ApiError(404, 'destination_not_found', 'That destination is not an option in this trip');
}

module.exports = { pollRouter };
