const { createTestDb } = require('./testDb');

let t;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

// A trip with three members and three destinations.
async function setUpPoll() {
  const trip = await t.createTrip();
  const [a, b, c] = [
    await t.createMember(trip.trip_id, 'A'),
    await t.createMember(trip.trip_id, 'B'),
    await t.createMember(trip.trip_id, 'C'),
  ];
  const [rome, paris, oslo] = [
    await t.createDestination(trip.trip_id, 'Rome'),
    await t.createDestination(trip.trip_id, 'Paris'),
    await t.createDestination(trip.trip_id, 'Oslo'),
  ].map((d) => d.destination_id);
  return { tripId: trip.trip_id, a, b, c, rome, paris, oslo };
}

const ballotOf = async (memberId) =>
  t.one('select ordered_destination_ids from ballots where member_id = $1', [memberId]);

describe('ballots', () => {
  it('FR-08: saves a ranked ballot in order', async () => {
    const p = await setUpPoll();

    await t.createBallot(p.tripId, p.a.member_id, [p.paris, p.rome, p.oslo]);

    expect((await ballotOf(p.a.member_id)).ordered_destination_ids).toEqual([
      p.paris,
      p.rome,
      p.oslo,
    ]);
  });

  it('SEC-03 / NFR-02: allows only one ballot per member per trip', async () => {
    const p = await setUpPoll();
    await t.createBallot(p.tripId, p.a.member_id, [p.rome]);

    await expect(t.createBallot(p.tripId, p.a.member_id, [p.oslo])).rejects.toThrow(
      /ballots_one_per_member/,
    );
  });

  it('FR-26: replacing a ballot keeps a single ballot for the member', async () => {
    const p = await setUpPoll();
    await t.createBallot(p.tripId, p.a.member_id, [p.rome]);

    await t.db.query(
      `insert into ballots (trip_id, member_id, ordered_destination_ids) values ($1, $2, $3)
       on conflict (trip_id, member_id)
       do update set ordered_destination_ids = excluded.ordered_destination_ids,
                     submitted_at = now()`,
      [p.tripId, p.a.member_id, [p.oslo, p.paris]],
    );

    const count = await t.one('select count(*)::int as n from ballots where member_id = $1', [
      p.a.member_id,
    ]);
    expect(count.n).toBe(1);
    expect((await ballotOf(p.a.member_id)).ordered_destination_ids).toEqual([p.oslo, p.paris]);
  });

  it('FR-08: rejects an empty ballot', async () => {
    const p = await setUpPoll();

    await expect(t.createBallot(p.tripId, p.a.member_id, [])).rejects.toThrow(
      /ballots_ranking_valid/,
    );
  });

  it('FR-08: rejects a ballot that ranks the same destination twice', async () => {
    const p = await setUpPoll();

    await expect(t.createBallot(p.tripId, p.a.member_id, [p.rome, p.rome])).rejects.toThrow(
      /ballots_ranking_valid/,
    );
  });

  it('rejects a ballot from a member of a different trip', async () => {
    const p = await setUpPoll();
    const outsider = await t.createMember((await t.createTrip()).trip_id);

    await expect(t.createBallot(p.tripId, outsider.member_id, [p.rome])).rejects.toThrow(
      /ballots_member_fkey/,
    );
  });

  it('FR-20: removing a member discards their ballot', async () => {
    const p = await setUpPoll();
    await t.createBallot(p.tripId, p.a.member_id, [p.rome]);

    await t.db.query('delete from members where member_id = $1', [p.a.member_id]);

    expect(await ballotOf(p.a.member_id)).toBeUndefined();
  });
});

describe('removing a destination', () => {
  it('removes it from ballots so later ranks move up', async () => {
    const p = await setUpPoll();
    await t.createBallot(p.tripId, p.a.member_id, [p.rome, p.paris, p.oslo]);

    await t.db.query('delete from destinations where destination_id = $1', [p.paris]);

    expect((await ballotOf(p.a.member_id)).ordered_destination_ids).toEqual([p.rome, p.oslo]);
  });

  it('deletes a ballot that ranked only that destination', async () => {
    const p = await setUpPoll();
    await t.createBallot(p.tripId, p.b.member_id, [p.paris]);

    await t.db.query('delete from destinations where destination_id = $1', [p.paris]);

    expect(await ballotOf(p.b.member_id)).toBeUndefined();
  });

  it('leaves ballots that did not rank it unchanged', async () => {
    const p = await setUpPoll();
    await t.createBallot(p.tripId, p.c.member_id, [p.oslo, p.rome]);

    await t.db.query('delete from destinations where destination_id = $1', [p.paris]);

    expect((await ballotOf(p.c.member_id)).ordered_destination_ids).toEqual([p.oslo, p.rome]);
  });
});
