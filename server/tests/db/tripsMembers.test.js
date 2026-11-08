const { createTestDb } = require('./testDb');

let t;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

describe('trips', () => {
  it('FR-01: creates a trip with a random id, open status and no winner', async () => {
    const trip = await t.createTrip('Spring break');

    expect(trip.trip_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(trip.status).toBe('open');
    expect(trip.winner_id).toBeNull();
    expect(trip.deadline).toBeNull();
  });

  it('FR-01: accepts a name of 80 characters and rejects 81', async () => {
    await expect(t.createTrip('x'.repeat(80))).resolves.toBeDefined();
    await expect(t.createTrip('x'.repeat(81))).rejects.toThrow(/trips_name_valid/);
  });

  it('FR-01: rejects an empty or untrimmed name', async () => {
    await expect(t.createTrip('')).rejects.toThrow(/trips_name_valid/);
    await expect(t.createTrip(' Rome ')).rejects.toThrow(/trips_name_valid/);
  });

  it('allows only the open, closed and tie statuses', async () => {
    const trip = await t.createTrip();
    for (const status of ['closed', 'tie', 'open']) {
      await t.db.query('update trips set status = $1 where trip_id = $2', [status, trip.trip_id]);
    }

    await expect(
      t.db.query("update trips set status = 'done' where trip_id = $1", [trip.trip_id]),
    ).rejects.toThrow(/trips_status_valid/);
  });

  it('FR-28: stores an optional deadline', async () => {
    const trip = await t.one(
      "insert into trips (name, deadline) values ('Trip', '2026-12-01T18:00:00Z') returning *",
    );

    expect(new Date(trip.deadline).toISOString()).toBe('2026-12-01T18:00:00.000Z');
  });
});

describe('members', () => {
  it('FR-02: accepts a display name of 30 characters and rejects 31', async () => {
    const trip = await t.createTrip();

    await expect(t.createMember(trip.trip_id, 'x'.repeat(30))).resolves.toBeDefined();
    await expect(t.createMember(trip.trip_id, 'y'.repeat(31))).rejects.toThrow(
      /members_display_name_valid/,
    );
  });

  it('FR-02: rejects an empty or untrimmed display name', async () => {
    const trip = await t.createTrip();

    await expect(t.createMember(trip.trip_id, '')).rejects.toThrow(/members_display_name_valid/);
    await expect(t.createMember(trip.trip_id, ' Alex')).rejects.toThrow(
      /members_display_name_valid/,
    );
  });

  it('rejects a duplicate display name in the same trip, ignoring case', async () => {
    const trip = await t.createTrip();
    await t.createMember(trip.trip_id, 'Alex');

    await expect(t.createMember(trip.trip_id, 'aLEX')).rejects.toThrow(
      /members_unique_name_per_trip/,
    );
  });

  it('allows the same display name in different trips', async () => {
    const tripA = await t.createTrip();
    const tripB = await t.createTrip();
    await t.createMember(tripA.trip_id, 'Alex');

    await expect(t.createMember(tripB.trip_id, 'Alex')).resolves.toBeDefined();
  });

  it('allows only one organizer per trip', async () => {
    const trip = await t.createTrip();
    await t.createMember(trip.trip_id, 'Organizer', true);

    await expect(t.createMember(trip.trip_id, 'Second', true)).rejects.toThrow(
      /members_one_organizer_per_trip/,
    );
  });

  it('FR-31: requires every token hash to be unique', async () => {
    const trip = await t.createTrip();
    const insert = (name) =>
      t.db.query(
        "insert into members (trip_id, display_name, token_hash) values ($1, $2, 'same-hash')",
        [trip.trip_id, name],
      );
    await insert('First');

    await expect(insert('Second')).rejects.toThrow(/members_token_hash_key/);
  });

  it('rejects a member for a trip that does not exist', async () => {
    await expect(
      t.createMember('00000000-0000-4000-8000-000000000000', 'Ghost'),
    ).rejects.toThrow(/foreign key/);
  });
});
