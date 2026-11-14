const request = require('supertest');
const { createTestApp } = require('./apiTestApp');

let ctx;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(() => ctx.close());

const api = () => request(ctx.app);

// A trip with an organizer and two members. Each person has a helper that sends
// their token: as.organizer.get(path), as.alex.post(path).send(body), ...
async function setUpTrip() {
  const created = await api()
    .post('/api/trips')
    .send({ name: 'Euro trip', organizerName: 'Organizer' });
  const tripId = created.body.trip.tripId;
  const tokens = { organizer: created.body.memberToken };
  for (const name of ['Alex', 'Blake']) {
    const joined = await api().post(`/api/trips/${tripId}/members`).send({ displayName: name });
    tokens[name.toLowerCase()] = joined.body.memberToken;
  }

  const as = {};
  for (const [who, token] of Object.entries(tokens)) {
    const withToken = (req) => {
      req.set('X-Member-Token', token);
      if (who === 'organizer') req.set('X-Organizer-Token', token);
      return req;
    };
    const path = (p) => `/api/trips/${tripId}${p}`;
    as[who] = {
      get: (p) => withToken(api().get(path(p))),
      post: (p) => withToken(api().post(path(p))),
      put: (p) => withToken(api().put(path(p))),
      delete: (p) => withToken(api().delete(path(p))),
    };
  }
  return { tripId, as };
}

async function addDestination(person, name, note) {
  const res = await person.post('/destinations').send({ name, note });
  return res.body.destination.destinationId;
}

// A trip with three destinations already added.
async function setUpPoll() {
  const trip = await setUpTrip();
  const rome = await addDestination(trip.as.alex, 'Rome');
  const paris = await addDestination(trip.as.blake, 'Paris');
  const oslo = await addDestination(trip.as.organizer, 'Oslo');
  return { ...trip, rome, paris, oslo };
}

describe('destinations', () => {
  it('FR-05: a member adds a destination with a note', async () => {
    const { as } = await setUpTrip();

    const res = await as.alex.post('/destinations').send({ name: '  Rome ', note: ' Pasta ' });

    expect(res.status).toBe(201);
    expect(res.body.destination).toMatchObject({ name: 'Rome', note: 'Pasta' });
  });

  it('stores a blank note as no note', async () => {
    const { as } = await setUpTrip();

    const res = await as.alex.post('/destinations').send({ name: 'Rome', note: '   ' });

    expect(res.body.destination.note).toBeNull();
  });

  it('lists destinations in the order they were added', async () => {
    const { as } = await setUpPoll();

    const res = await as.blake.get('/destinations');

    expect(res.status).toBe(200);
    expect(res.body.destinations.map((d) => d.name)).toEqual(['Rome', 'Paris', 'Oslo']);
  });

  it('FR-06: rejects a duplicate after trimming and ignoring case, pointing to the existing one', async () => {
    const { as } = await setUpTrip();
    const rome = await addDestination(as.alex, 'Rome');

    const res = await as.blake.post('/destinations').send({ name: '  ROME ' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'duplicate_destination',
      existingDestinationId: rome,
    });
  });

  it.each([
    ['a missing name', { note: 'x' }],
    ['a blank name', { name: '   ' }],
    ['a name of 61 characters', { name: 'x'.repeat(61) }],
    ['a note of 201 characters', { name: 'Rome', note: 'x'.repeat(201) }],
    ['a note that is not text', { name: 'Rome', note: 5 }],
  ])('FR-05: rejects %s with 400', async (label, body) => {
    const { as } = await setUpTrip();

    expect((await as.alex.post('/destinations').send(body)).status).toBe(400);
  });

  it('accepts a 60-character name and a 200-character note', async () => {
    const { as } = await setUpTrip();

    const res = await as.alex.post('/destinations').send({ name: 'x'.repeat(60), note: 'y'.repeat(200) });

    expect(res.status).toBe(201);
  });

  it('SEC-01: requires a member token to list or add', async () => {
    const { tripId } = await setUpTrip();

    expect((await api().get(`/api/trips/${tripId}/destinations`)).status).toBe(401);
    expect((await api().post(`/api/trips/${tripId}/destinations`).send({ name: 'Rome' })).status).toBe(401);
  });

  it('FR-05: rejects new destinations once the poll is closed', async () => {
    const { as } = await setUpTrip();
    await as.organizer.post('/close');

    const res = await as.alex.post('/destinations').send({ name: 'Rome' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('poll_closed');
  });
});

describe('removing a destination', () => {
  it('lets the organizer remove one', async () => {
    const { as, paris } = await setUpPoll();

    const res = await as.organizer.delete(`/destinations/${paris}`);

    expect(res.status).toBe(204);
    expect((await as.alex.get('/destinations')).body.destinations.map((d) => d.name)).toEqual([
      'Rome',
      'Oslo',
    ]);
  });

  it('SEC-02: returns 403 to a regular member', async () => {
    const { as, rome } = await setUpPoll();

    const res = await as.alex.delete(`/destinations/${rome}`);

    expect(res.status).toBe(403);
    expect((await as.alex.get('/destinations')).body.destinations).toHaveLength(3);
  });

  it('returns 404 for a destination from another trip', async () => {
    const mine = await setUpTrip();
    const other = await setUpPoll();

    const res = await mine.as.organizer.delete(`/destinations/${other.rome}`);

    expect(res.status).toBe(404);
    expect((await other.as.alex.get('/destinations')).body.destinations).toHaveLength(3);
  });

  it('is not allowed once the poll is closed', async () => {
    const { as, rome } = await setUpPoll();
    await as.organizer.post('/close');

    expect((await as.organizer.delete(`/destinations/${rome}`)).status).toBe(409);
  });
});

describe('closing the poll (FR-11)', () => {
  it('lets the organizer close it', async () => {
    const { as } = await setUpPoll();

    const res = await as.organizer.post('/close');

    expect(res.status).toBe(200);
    expect((await as.alex.get('')).body.trip.status).toBe('closed');
  });

  it('SEC-02: returns 403 to a regular member and leaves the poll open', async () => {
    const { as } = await setUpPoll();

    expect((await as.alex.post('/close')).status).toBe(403);
    expect((await as.alex.get('')).body.trip.status).toBe('open');
  });

  it('returns 409 if the poll is already closed', async () => {
    const { as } = await setUpPoll();
    await as.organizer.post('/close');

    const res = await as.organizer.post('/close');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('poll_not_open');
  });
});
