const { createTestDb } = require('./testDb');

let t;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

// The update the API will run: succeeds only if the client's version is current.
const editItem = (itemId, expectedVersion, title) =>
  t.rows(
    `update itinerary_items
        set title = $3, version = version + 1, updated_at = now()
      where item_id = $1 and version = $2
      returning *`,
    [itemId, expectedVersion, title],
  );

describe('itinerary items', () => {
  it('FR-22: saves an item at version 1 with its creator and UTC start time', async () => {
    const trip = await t.createTrip();
    const alex = await t.createMember(trip.trip_id, 'Alex');

    const item = await t.createItem(trip.trip_id, {
      title: 'Colosseum',
      startsAt: '2026-12-12T08:00:00Z',
      createdBy: alex.member_id,
    });

    expect(item.version).toBe(1);
    expect(item.created_by).toBe(alex.member_id);
    expect(new Date(item.starts_at).toISOString()).toBe('2026-12-12T08:00:00.000Z');
  });

  it('FR-22: accepts a title of 100 characters and rejects 101 or empty', async () => {
    const trip = await t.createTrip();

    await expect(t.createItem(trip.trip_id, { title: 'x'.repeat(100) })).resolves.toBeDefined();
    await expect(t.createItem(trip.trip_id, { title: 'x'.repeat(101) })).rejects.toThrow(
      /itinerary_items_title_valid/,
    );
    await expect(t.createItem(trip.trip_id, { title: '' })).rejects.toThrow(
      /itinerary_items_title_valid/,
    );
  });

  it('FR-22: requires a start time', async () => {
    const trip = await t.createTrip();

    await expect(
      t.db.query("insert into itinerary_items (trip_id, title) values ($1, 'No time')", [
        trip.trip_id,
      ]),
    ).rejects.toThrow(/starts_at/);
  });

  it('accepts a description of 500 characters and rejects 501', async () => {
    const trip = await t.createTrip();

    await expect(
      t.createItem(trip.trip_id, { description: 'x'.repeat(500) }),
    ).resolves.toBeDefined();
    await expect(t.createItem(trip.trip_id, { description: 'x'.repeat(501) })).rejects.toThrow(
      /itinerary_items_description_valid/,
    );
  });

  it('FR-23: an edit with the current version saves and increments the version', async () => {
    const trip = await t.createTrip();
    const item = await t.createItem(trip.trip_id);

    const [updated] = await editItem(item.item_id, 1, 'Forum');

    expect(updated.title).toBe('Forum');
    expect(updated.version).toBe(2);
  });

  it('FR-25 / NFR-03: an edit with an outdated version changes nothing', async () => {
    const trip = await t.createTrip();
    const item = await t.createItem(trip.trip_id, { title: 'Original' });
    await editItem(item.item_id, 1, 'First edit');

    const stale = await editItem(item.item_id, 1, 'Stale edit');

    expect(stale).toHaveLength(0);
    const stored = await t.one('select * from itinerary_items where item_id = $1', [item.item_id]);
    expect(stored.title).toBe('First edit');
    expect(stored.version).toBe(2);
  });

  it('rejects a creator who belongs to a different trip', async () => {
    const trip = await t.createTrip();
    const outsider = await t.createMember((await t.createTrip()).trip_id);

    await expect(
      t.createItem(trip.trip_id, { createdBy: outsider.member_id }),
    ).rejects.toThrow(/itinerary_items_created_by_fkey/);
  });
});
