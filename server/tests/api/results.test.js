const request = require('supertest');
const { createTestApp } = require('./apiTestApp');
const { pollHelpers } = require('./pollHelpers');

let ctx;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(() => ctx.close());

const api = () => request(ctx.app);
const { setUpPoll, setUpTrip, addDestination, vote } = pollHelpers(api);

// Moves the trip's deadline into the past, as if time had passed.
const expireDeadline = (tripId) =>
  ctx.db.query(`update trips set deadline = now() - interval '1 minute' where trip_id = $1`, [tripId]);

const status = async (person) => (await person.get('')).body.trip;

describe('closing counts the results (FR-11, FR-13)', () => {
  it('stores the instant-runoff winner when the organizer closes', async () => {
    const { as, rome, paris, oslo } = await setUpPoll();
    await vote(as.organizer, [rome, paris]);
    await vote(as.alex, [rome]);
    await vote(as.blake, [oslo, paris]);

    const res = await as.organizer.post('/close');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'closed', winnerId: rome });
    expect(await status(as.blake)).toMatchObject({ status: 'closed', winnerId: rome });
  });

  it('FR-29: closes with no winner when nobody voted', async () => {
    const { as } = await setUpPoll();

    const res = await as.organizer.post('/close');

    expect(res.body).toEqual({ status: 'closed', winnerId: null });
    const results = await as.alex.get('/results');
    expect(results.body).toMatchObject({ outcome: 'no_winner', winnerId: null, rounds: [], ballotCount: 0 });
  });

  it('FR-29: closes with no winner with fewer than two destinations', async () => {
    const { as } = await setUpTrip();
    await addDestination(as.alex, 'Rome');

    await as.organizer.post('/close');

    expect((await as.alex.get('/results')).body).toMatchObject({ outcome: 'no_winner', optionCount: 1 });
  });
});

describe('results (FR-15, SEC-04)', () => {
  it('shows each round with names and vote counts, and nothing per ballot', async () => {
    const { as, rome, paris, oslo } = await setUpPoll();
    // Round 1: Rome 1, Paris 1, Oslo 1. Oslo (added last) goes; its ballot moves to Paris.
    await vote(as.organizer, [rome]);
    await vote(as.alex, [paris]);
    await vote(as.blake, [oslo, paris]);
    await as.organizer.post('/close');

    const res = await as.alex.get('/results');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'closed',
      outcome: 'winner',
      winnerId: paris,
      chosenByOrganizer: false,
      finalists: [],
      ballotCount: 3,
      optionCount: 3,
      rounds: [
        {
          round: 1,
          counts: [
            { destinationId: oslo, name: 'Oslo', votes: 1 },
            { destinationId: paris, name: 'Paris', votes: 1 },
            { destinationId: rome, name: 'Rome', votes: 1 },
          ],
          exhausted: 0,
          activeBallots: 3,
          eliminatedId: oslo,
        },
        {
          round: 2,
          counts: [
            { destinationId: paris, name: 'Paris', votes: 2 },
            { destinationId: rome, name: 'Rome', votes: 1 },
          ],
          exhausted: 0,
          activeBallots: 3,
          eliminatedId: null,
        },
      ],
    });
    // SEC-04: no member ids or rankings anywhere in the response.
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/memberId|ranked|ballots"/);
  });

  it('is not available while the poll is open', async () => {
    const { as } = await setUpPoll();

    const res = await as.alex.get('/results');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('poll_open');
  });

  it('SEC-01: needs a member token', async () => {
    const { tripId, as } = await setUpPoll();
    await as.organizer.post('/close');

    expect((await api().get(`/api/trips/${tripId}/results`)).status).toBe(401);
  });
});

describe('final-two tie (FR-14, FR-30)', () => {
  async function tiedPoll() {
    const trip = await setUpPoll();
    const { as, rome, paris } = trip;
    await vote(as.alex, [rome]);
    await vote(as.blake, [paris]);
    await as.organizer.post('/close');
    return trip;
  }

  it('marks the poll as a tie and lists the finalists', async () => {
    const { as, rome, paris } = await tiedPoll();

    expect(await status(as.alex)).toMatchObject({ status: 'tie', winnerId: null });
    const results = (await as.alex.get('/results')).body;
    expect(results.outcome).toBe('tie');
    expect(results.finalists.map((f) => f.destinationId).sort()).toEqual([rome, paris].sort());
  });

  it('lets the organizer pick one of the finalists as the winner', async () => {
    const { as, paris } = await tiedPoll();

    const res = await as.organizer.post('/resolve-tie').send({ destinationId: paris });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'closed', winnerId: paris });
    const results = (await as.alex.get('/results')).body;
    expect(results).toMatchObject({ status: 'closed', winnerId: paris, chosenByOrganizer: true });
  });

  it('rejects a destination that is not a finalist', async () => {
    const { as, oslo } = await tiedPoll();

    const res = await as.organizer.post('/resolve-tie').send({ destinationId: oslo });

    expect(res.status).toBe(400);
    expect((await status(as.alex)).status).toBe('tie');
  });

  it('FR-19 / SEC-02: a regular member cannot pick the winner', async () => {
    const { as, paris } = await tiedPoll();

    expect((await as.alex.post('/resolve-tie').send({ destinationId: paris })).status).toBe(403);
    expect((await status(as.alex)).status).toBe('tie');
  });

  it('returns 409 when there is no tie', async () => {
    const { as, rome } = await setUpPoll();
    await vote(as.alex, [rome]);
    await as.organizer.post('/close');

    const res = await as.organizer.post('/resolve-tie').send({ destinationId: rome });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('no_tie');
  });
});

describe('reopening (FR-27)', () => {
  it('keeps ballots, clears the winner and allows voting again', async () => {
    const { as, rome, paris } = await setUpPoll();
    await vote(as.alex, [rome]);
    await as.organizer.post('/close');

    const res = await as.organizer.post('/reopen');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'open', deadline: null });
    expect(await status(as.alex)).toMatchObject({ status: 'open', winnerId: null, votedCount: 1 });
    expect((await as.alex.get('/ballot')).body.ballot.rankedDestinationIds).toEqual([rome]);
    expect((await vote(as.blake, [paris])).status).toBe(200);
  });

  it('reopens a tied poll', async () => {
    const { as, rome, paris } = await setUpPoll();
    await vote(as.alex, [rome]);
    await vote(as.blake, [paris]);
    await as.organizer.post('/close');

    expect((await as.organizer.post('/reopen')).status).toBe(200);
    expect((await status(as.alex)).status).toBe('open');
  });

  it('accepts a new future deadline', async () => {
    const { as } = await setUpPoll();
    await as.organizer.post('/close');
    const deadline = new Date(Date.now() + 86_400_000).toISOString();

    const res = await as.organizer.post('/reopen').send({ deadline });

    expect(res.body.deadline).toBe(deadline);
  });

  it('FR-19 / SEC-02: a regular member cannot reopen', async () => {
    const { as } = await setUpPoll();
    await as.organizer.post('/close');

    expect((await as.alex.post('/reopen')).status).toBe(403);
    expect((await status(as.alex)).status).toBe('closed');
  });

  it('returns 409 if the poll is already open', async () => {
    const { as } = await setUpPoll();

    const res = await as.organizer.post('/reopen');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('poll_not_closed');
  });
});

describe('deadline (FR-28)', () => {
  it('closes and counts the poll once the deadline has passed', async () => {
    const { tripId, as, rome } = await setUpPoll();
    await vote(as.alex, [rome]);
    await expireDeadline(tripId);

    expect(await status(as.blake)).toMatchObject({ status: 'closed', winnerId: rome });
  });

  it('FR-12: rejects a vote after the deadline', async () => {
    const { tripId, as, rome } = await setUpPoll();
    await expireDeadline(tripId);

    const res = await vote(as.alex, [rome]);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('poll_closed');
  });

  it('closes when the next request is for results', async () => {
    const { tripId, as, rome } = await setUpPoll();
    await vote(as.alex, [rome]);
    await expireDeadline(tripId);

    const res = await as.alex.get('/results');

    expect(res.status).toBe(200);
    expect(res.body.winnerId).toBe(rome);
  });

  it('leaves the poll open before the deadline', async () => {
    const created = await api().post('/api/trips').send({
      name: 'Later trip',
      organizerName: 'Org',
      deadline: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const { tripId } = created.body.trip;

    const res = await api().get(`/api/trips/${tripId}`).set('X-Member-Token', created.body.memberToken);

    expect(res.body.trip.status).toBe('open');
  });
});
