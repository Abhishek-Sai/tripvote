const { Router } = require('express');
const { ApiError, badRequest } = require('../lib/errors');
const { isUuid, requiredText } = require('../lib/validate');
const { requireMember, requireOrganizer } = require('../middleware/auth');

const MIN_OPTIONS_TO_VOTE = 2; // FR-07

const pollClosed = () =>
  new ApiError(409, 'poll_closed', 'Voting has been closed for this trip.');

// Locks the trip row for the rest of the transaction and checks the poll is
// open. FOR SHARE lets members add options and vote at the same time, but makes
// a concurrent "Close poll" wait, so nothing slips in after closing (FR-12).
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

function parseRanking(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw badRequest('rankedDestinationIds must be a non-empty list, most preferred first');
  }
  if (!value.every(isUuid)) throw badRequest('rankedDestinationIds must contain destination ids');
  const lower = value.map((id) => id.toLowerCase());
  if (new Set(lower).size !== lower.length) {
    throw badRequest('Each destination can be ranked only once');
  }
  return lower;
}

function formatDestination(row) {
  return {
    destinationId: row.destination_id,
    name: row.name,
    note: row.note,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

// Destinations, ballots and closing the poll. Every route needs a member token.
// FR-09 / SEC-04: no route here returns or logs another member's ranking.
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

  // FR-07 / FR-08 / FR-26: submit or replace this member's ranked ballot.
  router.put('/:tripId/ballot', member, async (req, res) => {
    const { tripId } = req.params;
    const ranking = parseRanking(req.body?.rankedDestinationIds);

    const ballot = await db.transaction(async (tx) => {
      await requireOpenPoll(tx, tripId); // FR-12

      const { rows: options } = await tx.query(
        'select destination_id from destinations where trip_id = $1',
        [tripId],
      );
      if (options.length < MIN_OPTIONS_TO_VOTE) {
        throw new ApiError(409, 'not_enough_options', 'Voting opens once there are at least 2 destinations.');
      }
      const valid = new Set(options.map((o) => o.destination_id));
      if (!ranking.every((id) => valid.has(id))) {
        throw badRequest('Every ranked destination must be an option in this trip');
      }

      // SEC-03: the unique (trip_id, member_id) constraint keeps one ballot.
      const { rows } = await tx.query(
        `insert into ballots (trip_id, member_id, ordered_destination_ids)
         values ($1, $2, $3::uuid[])
         on conflict (trip_id, member_id)
         do update set ordered_destination_ids = excluded.ordered_destination_ids,
                       submitted_at = now()
         returning ordered_destination_ids, submitted_at`,
        [tripId, req.member.memberId, ranking],
      );
      return rows[0];
    });

    res.json({ message: 'Vote saved.', ballot: formatBallot(ballot) });
  });

  // FR-09: a member sees only their own ballot.
  router.get('/:tripId/ballot', member, async (req, res) => {
    const { rows } = await db.query(
      `select ordered_destination_ids, submitted_at
         from ballots
        where trip_id = $1 and member_id = $2`,
      [req.params.tripId, req.member.memberId],
    );
    res.json({ ballot: rows.length ? formatBallot(rows[0]) : null });
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

function formatBallot(row) {
  return {
    rankedDestinationIds: row.ordered_destination_ids,
    submittedAt: new Date(row.submitted_at).toISOString(),
  };
}

module.exports = { pollRouter };
