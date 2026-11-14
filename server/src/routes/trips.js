const { Router } = require('express');
const { ApiError } = require('../lib/errors');
const { generateToken, hashToken } = require('../lib/tokens');
const { isUuid, optionalFutureDeadline, requiredText } = require('../lib/validate');
const { requireMember } = require('../middleware/auth');

const MAX_MEMBERS = 20; // FR-04

const tripNotFound = () => new ApiError(404, 'trip_not_found', 'This trip does not exist');

const nameTaken = () =>
  new ApiError(409, 'name_taken', 'Someone in this trip already uses that name');

// Postgres error for a unique-constraint violation.
const isUniqueViolation = (err, constraint) =>
  err.code === '23505' && (!constraint || err.constraint === constraint);

async function insertMember(tx, tripId, displayName, organizer) {
  const token = generateToken();
  try {
    const { rows } = await tx.query(
      `insert into members (trip_id, display_name, token_hash, organizer_flag)
       values ($1, $2, $3, $4)
       returning member_id, display_name, organizer_flag`,
      [tripId, displayName, hashToken(token), organizer],
    );
    return { token, member: rows[0] };
  } catch (err) {
    if (isUniqueViolation(err, 'members_unique_name_per_trip')) throw nameTaken();
    throw err;
  }
}

function tripsRouter(db) {
  const router = Router();

  // FR-01: create a trip and its organizer. Returns the organizer token once;
  // only its hash is stored, so it cannot be shown again.
  router.post('/', async (req, res) => {
    const name = requiredText(req.body?.name, 'name', 80);
    const organizerName = requiredText(req.body?.organizerName, 'organizerName', 30);
    const deadline = optionalFutureDeadline(req.body?.deadline);

    const result = await db.transaction(async (tx) => {
      const { rows } = await tx.query(
        `insert into trips (name, deadline) values ($1, $2)
         returning trip_id, name, deadline, status, created_at`,
        [name, deadline],
      );
      const trip = rows[0];
      const { token, member } = await insertMember(tx, trip.trip_id, organizerName, true);
      return { trip, token, member };
    });

    const { trip, token, member } = result;
    res.status(201).json({
      trip: formatTrip(trip),
      member: formatMember(member),
      memberToken: token,
      sharePath: `/trip/${trip.trip_id}`,
      organizerPath: `/trip/${trip.trip_id}/organizer#${token}`,
    });
  });

  // FR-03 / FR-04: what the join screen needs before someone joins. Only the trip
  // name and whether it is full; nothing private (SEC-01).
  router.get('/:tripId/preview', async (req, res) => {
    const { tripId } = req.params;
    if (!isUuid(tripId)) throw tripNotFound();

    const { rows } = await db.query(
      `select t.name, count(m.member_id)::int as member_count
         from trips t
         left join members m on m.trip_id = t.trip_id
        where t.trip_id = $1
        group by t.trip_id`,
      [tripId],
    );
    if (rows.length === 0) throw tripNotFound();

    res.json({ name: rows[0].name, isFull: rows[0].member_count >= MAX_MEMBERS });
  });

  // FR-02 / FR-04 / FR-31: join with a display name, no account.
  router.post('/:tripId/members', async (req, res) => {
    const { tripId } = req.params;
    if (!isUuid(tripId)) throw tripNotFound();
    const displayName = requiredText(req.body?.displayName, 'displayName', 30);

    const { token, member } = await db.transaction(async (tx) => {
      // Lock the trip row so two people joining at once cannot both pass the
      // capacity check (PR-04).
      const trip = await tx.query('select trip_id from trips where trip_id = $1 for update', [
        tripId,
      ]);
      if (trip.rows.length === 0) throw tripNotFound();

      const { rows } = await tx.query(
        'select count(*)::int as n from members where trip_id = $1',
        [tripId],
      );
      if (rows[0].n >= MAX_MEMBERS) {
        throw new ApiError(409, 'trip_full', 'This trip is full.');
      }

      return insertMember(tx, tripId, displayName, false);
    });

    res.status(201).json({ member: formatMember(member), memberToken: token });
  });

  // SEC-01: trip details for its members only. Also how a returning browser
  // checks its saved token still works (FR-31).
  router.get('/:tripId', requireMember(db), async (req, res) => {
    const { rows } = await db.query(
      `select t.trip_id, t.name, t.deadline, t.status, t.created_at, t.winner_id,
              (select count(*)::int from members m where m.trip_id = t.trip_id) as member_count
         from trips t
        where t.trip_id = $1`,
      [req.params.tripId],
    );
    if (rows.length === 0) throw tripNotFound();

    res.json({
      trip: { ...formatTrip(rows[0]), winnerId: rows[0].winner_id, memberCount: rows[0].member_count },
      me: req.member,
    });
  });

  return router;
}

function formatTrip(row) {
  return {
    tripId: row.trip_id,
    name: row.name,
    deadline: row.deadline ? new Date(row.deadline).toISOString() : null,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function formatMember(row) {
  return {
    memberId: row.member_id,
    displayName: row.display_name,
    isOrganizer: row.organizer_flag,
  };
}

module.exports = { tripsRouter, MAX_MEMBERS };
