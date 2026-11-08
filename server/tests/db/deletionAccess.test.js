const { createTestDb } = require('./testDb');

let t;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

const TABLES = ['trips', 'members', 'destinations', 'ballots', 'itinerary_items'];

describe('deleting a trip', () => {
  it('FR-21: removes its members, destinations, ballots and itinerary items', async () => {
    const trip = await t.createTrip();
    const member = await t.createMember(trip.trip_id, 'Alex');
    const rome = await t.createDestination(trip.trip_id, 'Rome', member.member_id);
    await t.createBallot(trip.trip_id, member.member_id, [rome.destination_id]);
    await t.createItem(trip.trip_id, { createdBy: member.member_id });
    await t.db.query('update trips set winner_id = $1 where trip_id = $2', [
      rome.destination_id,
      trip.trip_id,
    ]);

    await t.db.query('delete from trips where trip_id = $1', [trip.trip_id]);

    for (const table of TABLES) {
      const { n } = await t.one(`select count(*)::int as n from ${table} where trip_id = $1`, [
        trip.trip_id,
      ]);
      expect(n).toBe(0);
    }
  });

  it('leaves other trips untouched', async () => {
    const keep = await t.createTrip('Keep');
    await t.createDestination(keep.trip_id, 'Oslo');
    const remove = await t.createTrip('Remove');

    await t.db.query('delete from trips where trip_id = $1', [remove.trip_id]);

    const { n } = await t.one('select count(*)::int as n from destinations where trip_id = $1', [
      keep.trip_id,
    ]);
    expect(n).toBe(1);
  });
});

describe('access', () => {
  afterEach(() => t.db.exec('reset role; set role service_role'));

  it.each(TABLES)('SEC-07: the public browser role cannot read %s', async (table) => {
    await t.db.exec('reset role; set role anon');

    await expect(t.db.query(`select * from ${table}`)).rejects.toThrow(/permission denied/);
  });

  it.each(TABLES)('SEC-07: the public browser role cannot write to %s', async (table) => {
    await t.db.exec('reset role; set role anon');

    await expect(t.db.query(`delete from ${table}`)).rejects.toThrow(/permission denied/);
  });

  it.each(TABLES)('row-level security is enabled on %s', async (table) => {
    const { relrowsecurity } = await t.one(
      "select relrowsecurity from pg_class where oid = ('public.' || $1)::regclass",
      [table],
    );

    expect(relrowsecurity).toBe(true);
  });
});
