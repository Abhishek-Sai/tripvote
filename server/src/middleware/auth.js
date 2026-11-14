const { ApiError } = require('../lib/errors');
const { hashToken } = require('../lib/tokens');
const { isUuid } = require('../lib/validate');

const invalidToken = () =>
  new ApiError(401, 'invalid_token', 'Missing, invalid or revoked member token');

// SEC-01 / SEC-09: the X-Member-Token must belong to a member of this trip.
// Removed members and deleted trips have no row, so their tokens fail here (FR-32, SEC-08).
function requireMember(db) {
  return async (req, res, next) => {
    const token = req.get('X-Member-Token');
    const { tripId } = req.params;
    if (!token || !isUuid(tripId)) throw invalidToken();

    const { rows } = await db.query(
      `select member_id, display_name, organizer_flag
         from members
        where token_hash = $1 and trip_id = $2`,
      [hashToken(token), tripId],
    );
    if (rows.length === 0) throw invalidToken();

    req.member = {
      memberId: rows[0].member_id,
      displayName: rows[0].display_name,
      isOrganizer: rows[0].organizer_flag,
    };
    next();
  };
}

// FR-19 / SEC-02: organizer-only actions also need X-Organizer-Token, which is the
// organizer's own member token. Use after requireMember.
function requireOrganizer(req, res, next) {
  const organizerToken = req.get('X-Organizer-Token');
  if (!req.member.isOrganizer || organizerToken !== req.get('X-Member-Token')) {
    throw new ApiError(403, 'forbidden', 'Only the organizer can do this');
  }
  next();
}

module.exports = { requireMember, requireOrganizer };
