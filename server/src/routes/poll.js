const { Router } = require('express');
const { ApiError, badRequest } = require('../lib/errors');
const { isUuid, optionalFutureDeadline, requiredText } = require('../lib/validate');
const { requireMember, requireOrganizer } = require('../middleware/auth');
const { closeAndCount, countTrip } = require('../lib/pollResults');
const { deadlineParam } = require('../middleware/deadline');

const MIN_OPTIONS_TO_VOTE = 2; // FR-07

const pollClosed = () =>
  new ApiError(409, 'poll_closed', 'Voting has been closed for this trip.');

// Locks the trip row for the rest of the transaction and checks the poll is
// open. FOR SHARE lets members add options and vote at the same time, but makes
// a concurrent "Close poll" wait, so nothing slips in after closing (FR-12).
async function requireOpenPoll(tx, tripId) {
  const { rows } = await tx.query(
    `select status, deadline is not null and deadline <= now() as deadline_passed
       from trips where trip_id = $1 for share`,
    [tripId],
  );
  // FR-28: a passed deadline counts as closed even before the poll is marked closed.
  if (rows.length === 0 || rows[0].status !== 'open' || rows[0].deadline_passed) throw pollClosed();
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
  router.param('tripId', deadlineParam(db));

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

  // FR-11 / FR-13: the organizer closes the poll and the results are counted.
  router.post('/:tripId/close', member, requireOrganizer, async (req, res) => {
    const outcome = await db.transaction(async (tx) => {
      const { rows } = await tx.query(
        'select status from trips where trip_id = $1 for update',
        [req.params.tripId],
      );
      if (rows[0]?.status !== 'open') {
        throw new ApiError(409, 'poll_not_open', 'The poll is already closed.');
      }
      return closeAndCount(tx, req.params.tripId);
    });
    res.json(outcome);
  });

  // FR-27: the organizer reopens a closed poll. Ballots stay; the winner is
  // cleared. A passed deadline would close it again at once, so the organizer
  // may set a new one; otherwise the deadline is removed.
  router.post('/:tripId/reopen', member, requireOrganizer, async (req, res) => {
    const deadline = optionalFutureDeadline(req.body?.deadline);
    const { rows } = await db.query(
      `update trips set status = 'open', winner_id = null, deadline = $2
        where trip_id = $1 and status in ('closed', 'tie')
        returning status, deadline`,
      [req.params.tripId, deadline],
    );
    if (rows.length === 0) {
      throw new ApiError(409, 'poll_not_closed', 'The poll is already open.');
    }
    res.json({
      status: rows[0].status,
      deadline: rows[0].deadline ? new Date(rows[0].deadline).toISOString() : null,
    });
  });

  // FR-30: the organizer picks the winner from the two tied finalists.
  router.post('/:tripId/resolve-tie', member, requireOrganizer, async (req, res) => {
    const { tripId } = req.params;
    const destinationId = req.body?.destinationId;
    if (!isUuid(destinationId)) throw badRequest('destinationId must be one of the tied destinations');

    await db.transaction(async (tx) => {
      const { rows } = await tx.query('select status from trips where trip_id = $1 for update', [tripId]);
      if (rows[0]?.status !== 'tie') {
        throw new ApiError(409, 'no_tie', 'There is no tie to resolve.');
      }
      // Ballots cannot change while the poll is closed, so this recount
      // gives the same finalists as when it closed.
      const { finalists } = await countTrip(tx, tripId);
      if (!finalists.includes(destinationId.toLowerCase())) {
        throw badRequest('destinationId must be one of the tied destinations');
      }
      await tx.query(
        `update trips set status = 'closed', winner_id = $2 where trip_id = $1`,
        [tripId, destinationId.toLowerCase()],
      );
    });

    res.json({ status: 'closed', winnerId: destinationId.toLowerCase() });
  });

  // FR-15 / SEC-04: round-by-round totals for a closed poll. Only aggregate
  // counts: never a ballot, a ranking, or who voted for what.
  router.get('/:tripId/results', member, async (req, res) => {
    const { tripId } = req.params;
    const { rows } = await db.query('select status, winner_id from trips where trip_id = $1', [tripId]);
    const { status, winner_id: winnerId } = rows[0];
    if (status === 'open') {
      throw new ApiError(409, 'poll_open', 'Results are available once the poll closes.');
    }

    const result = await countTrip(db, tripId);
    const names = new Map(result.options.map((o) => [o.destination_id, o.name]));
    res.json({
      status,
      outcome: result.outcome,
      winnerId,
      // FR-30: the count ended in a tie and the organizer chose.
      chosenByOrganizer: result.outcome === 'tie' && winnerId !== null,
      finalists: result.finalists.map((id) => ({ destinationId: id, name: names.get(id) })),
      ballotCount: result.ballotCount,
      optionCount: result.options.length,
      rounds: result.rounds.map((round, index) => ({
        round: index + 1,
        counts: Object.entries(round.counts)
          .map(([id, votes]) => ({ destinationId: id, name: names.get(id), votes }))
          .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name)),
        exhausted: round.exhausted,
        activeBallots: round.activeBallots,
        eliminatedId: round.eliminatedId,
      })),
    });
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
