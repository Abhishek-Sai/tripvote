const { createTestDb } = require('./testDb');

let t;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

describe('destinations', () => {
  it('FR-05: saves a destination with a note and its creator', async () => {
    const trip = await t.createTrip();
    const alex = await t.createMember(trip.trip_id, 'Alex');

    const rome = await t.createDestination(trip.trip_id, 'Rome', alex.member_id, 'Pasta');

    expect(rome.name).toBe('Rome');
    expect(rome.note).toBe('Pasta');
    expect(rome.created_by).toBe(alex.member_id);
  });

  it('FR-05: accepts a name of 60 characters and rejects 61 or empty', async () => {
    const trip = await t.createTrip();

    await expect(t.createDestination(trip.trip_id, 'x'.repeat(60))).resolves.toBeDefined();
    await expect(t.createDestination(trip.trip_id, 'y'.repeat(61))).rejects.toThrow(
      /destinations_name_valid/,
    );
    await expect(t.createDestination(trip.trip_id, '')).rejects.toThrow(/destinations_name_valid/);
  });

  it('FR-05: accepts a note of 2000 characters and rejects 2001', async () => {
    const trip = await t.createTrip();

    await expect(
      t.createDestination(trip.trip_id, 'A', null, 'x'.repeat(2000)),
    ).resolves.toBeDefined();
    await expect(t.createDestination(trip.trip_id, 'B', null, 'x'.repeat(2001))).rejects.toThrow(
      /destinations_note_valid/,
    );
  });

  it('FR-06: rejects a duplicate name in the same trip, ignoring case', async () => {
    const trip = await t.createTrip();
    await t.createDestination(trip.trip_id, 'Rome');

    await expect(t.createDestination(trip.trip_id, 'ROME')).rejects.toThrow(
      /destinations_unique_name_per_trip/,
    );
  });

  it('allows the same destination name in different trips', async () => {
    const tripA = await t.createTrip();
    const tripB = await t.createTrip();
    await t.createDestination(tripA.trip_id, 'Rome');

    await expect(t.createDestination(tripB.trip_id, 'Rome')).resolves.toBeDefined();
  });

  it('rejects a creator who belongs to a different trip', async () => {
    const trip = await t.createTrip();
    const outsider = await t.createMember((await t.createTrip()).trip_id);

    await expect(
      t.createDestination(trip.trip_id, 'Rome', outsider.member_id),
    ).rejects.toThrow(/destinations_created_by_fkey/);
  });

  it('keeps the destination and clears created_by when its creator is removed', async () => {
    const trip = await t.createTrip();
    const alex = await t.createMember(trip.trip_id, 'Alex');
    const rome = await t.createDestination(trip.trip_id, 'Rome', alex.member_id);

    await t.db.query('delete from members where member_id = $1', [alex.member_id]);

    const after = await t.one('select * from destinations where destination_id = $1', [
      rome.destination_id,
    ]);
    expect(after.created_by).toBeNull();
  });
});

describe('trip winner', () => {
  it('FR-16: accepts a winner from the same trip', async () => {
    const trip = await t.createTrip();
    const rome = await t.createDestination(trip.trip_id, 'Rome');

    await t.db.query("update trips set winner_id = $1, status = 'closed' where trip_id = $2", [
      rome.destination_id,
      trip.trip_id,
    ]);

    const after = await t.one('select winner_id from trips where trip_id = $1', [trip.trip_id]);
    expect(after.winner_id).toBe(rome.destination_id);
  });

  it('rejects a winner from a different trip', async () => {
    const trip = await t.createTrip();
    const elsewhere = await t.createDestination((await t.createTrip()).trip_id, 'Oslo');

    await expect(
      t.db.query('update trips set winner_id = $1 where trip_id = $2', [
        elsewhere.destination_id,
        trip.trip_id,
      ]),
    ).rejects.toThrow(/trips_winner_fkey/);
  });

  it('clears the winner if the winning destination is removed', async () => {
    const trip = await t.createTrip();
    const rome = await t.createDestination(trip.trip_id, 'Rome');
    await t.db.query('update trips set winner_id = $1 where trip_id = $2', [
      rome.destination_id,
      trip.trip_id,
    ]);

    await t.db.query('delete from destinations where destination_id = $1', [rome.destination_id]);

    const after = await t.one('select winner_id from trips where trip_id = $1', [trip.trip_id]);
    expect(after.winner_id).toBeNull();
  });
});
