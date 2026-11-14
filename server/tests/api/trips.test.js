const request = require('supertest');
const { createTestApp } = require('./apiTestApp');

let ctx;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(() => ctx.close());

const api = () => request(ctx.app);

const createTrip = (body = {}) =>
  api()
    .post('/api/trips')
    .send({ name: 'Spring break', organizerName: 'Sagar', ...body });

const join = (tripId, displayName) =>
  api().post(`/api/trips/${tripId}/members`).send({ displayName });

const MISSING_TRIP = '00000000-0000-4000-8000-000000000000';

describe('POST /api/trips (FR-01)', () => {
  it('creates the trip and its organizer and returns both links', async () => {
    const res = await createTrip({ name: '  Spring break  ', organizerName: ' Sagar ' });

    expect(res.status).toBe(201);
    const { trip, member, memberToken, sharePath, organizerPath } = res.body;
    expect(trip).toMatchObject({ name: 'Spring break', status: 'open', deadline: null });
    expect(member).toMatchObject({ displayName: 'Sagar', isOrganizer: true });
    expect(memberToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sharePath).toBe(`/trip/${trip.tripId}`);
    expect(organizerPath).toBe(`/trip/${trip.tripId}/organizer#${memberToken}`);
  });

  it('stores only a hash of the organizer token, never the token itself', async () => {
    const res = await createTrip();

    const { rows } = await ctx.db.query('select token_hash from members where member_id = $1', [
      res.body.member.memberId,
    ]);
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].token_hash).not.toContain(res.body.memberToken);
  });

  it('gives every trip a different token', async () => {
    const a = await createTrip();
    const b = await createTrip();

    expect(a.body.memberToken).not.toBe(b.body.memberToken);
    expect(a.body.trip.tripId).not.toBe(b.body.trip.tripId);
  });

  it('FR-28: accepts a future UTC deadline', async () => {
    const res = await createTrip({ deadline: '2099-01-01T12:00:00Z' });

    expect(res.status).toBe(201);
    expect(res.body.trip.deadline).toBe('2099-01-01T12:00:00.000Z');
  });

  it.each([
    ['a past deadline', { deadline: '2020-01-01T00:00:00Z' }],
    ['a deadline with no timezone', { deadline: '2099-01-01T12:00:00' }],
    ['a deadline that is not a date', { deadline: 'tomorrow' }],
    ['a missing trip name', { name: undefined }],
    ['a blank trip name', { name: '   ' }],
    ['a trip name of 81 characters', { name: 'x'.repeat(81) }],
    ['a missing organizer name', { organizerName: undefined }],
    ['an organizer name of 31 characters', { organizerName: 'x'.repeat(31) }],
    ['a trip name that is not text', { name: 42 }],
  ])('rejects %s with 400 and creates nothing', async (label, body) => {
    const before = await ctx.db.query('select count(*)::int as n from trips');

    const res = await createTrip(body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_input');
    const after = await ctx.db.query('select count(*)::int as n from trips');
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('accepts a trip name of exactly 80 characters', async () => {
    expect((await createTrip({ name: 'x'.repeat(80) })).status).toBe(201);
  });

  it('rejects a body that is not valid JSON', async () => {
    const res = await api()
      .post('/api/trips')
      .set('Content-Type', 'application/json')
      .send('{"name": ');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_json');
  });
});

describe('GET /api/trips/:tripId/preview', () => {
  it('returns only the trip name and whether it is full', async () => {
    const { body } = await createTrip({ name: 'Euro trip' });

    const res = await api().get(`/api/trips/${body.trip.tripId}/preview`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: 'Euro trip', isFull: false });
  });

  it.each([MISSING_TRIP, 'not-a-uuid'])('FR-03: returns 404 for an unknown trip (%s)', async (id) => {
    const res = await api().get(`/api/trips/${id}/preview`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('trip_not_found');
  });
});

describe('POST /api/trips/:tripId/members (FR-02)', () => {
  it('adds a member with a trimmed name and returns their token', async () => {
    const { body } = await createTrip();

    const res = await join(body.trip.tripId, '  Ruoran ');

    expect(res.status).toBe(201);
    expect(res.body.member).toMatchObject({ displayName: 'Ruoran', isOrganizer: false });
    expect(res.body.memberToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('rejects a name already used in the trip, ignoring case', async () => {
    const { body } = await createTrip({ organizerName: 'Sagar' });

    const res = await join(body.trip.tripId, 'SAGAR');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('name_taken');
  });

  it.each([
    ['a blank name', '  '],
    ['a name of 31 characters', 'x'.repeat(31)],
    ['a missing name', undefined],
  ])('rejects %s with 400', async (label, displayName) => {
    const { body } = await createTrip();

    expect((await join(body.trip.tripId, displayName)).status).toBe(400);
  });

  it.each([MISSING_TRIP, 'not-a-uuid'])('FR-03: returns 404 for an unknown trip (%s)', async (id) => {
    const res = await join(id, 'Alex');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('trip_not_found');
  });

  it('FR-04: lets the 20th member join and rejects the 21st with "This trip is full."', async () => {
    const { body } = await createTrip(); // the organizer is member 1
    const tripId = body.trip.tripId;
    for (let i = 2; i <= 20; i += 1) {
      expect((await join(tripId, `Member ${i}`)).status).toBe(201);
    }

    const res = await join(tripId, 'Member 21');

    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({ code: 'trip_full', message: 'This trip is full.' });
    expect((await api().get(`/api/trips/${tripId}/preview`)).body.isFull).toBe(true);
  });
});

describe('GET /api/trips/:tripId (SEC-01)', () => {
  it('FR-31: returns the trip to a member using their saved token', async () => {
    const { body } = await createTrip({ name: 'Euro trip' });
    const joined = await join(body.trip.tripId, 'Fanglin');

    const res = await api()
      .get(`/api/trips/${body.trip.tripId}`)
      .set('X-Member-Token', joined.body.memberToken);

    expect(res.status).toBe(200);
    expect(res.body.trip).toMatchObject({ name: 'Euro trip', memberCount: 2, status: 'open' });
    expect(res.body.me).toMatchObject({ displayName: 'Fanglin', isOrganizer: false });
  });

  it('identifies the organizer through the organizer link token', async () => {
    const { body } = await createTrip();

    const res = await api()
      .get(`/api/trips/${body.trip.tripId}`)
      .set('X-Member-Token', body.memberToken);

    expect(res.body.me.isOrganizer).toBe(true);
  });

  it('SEC-09: rejects a request with no token', async () => {
    const { body } = await createTrip();

    const res = await api().get(`/api/trips/${body.trip.tripId}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_token');
    expect(res.body.trip).toBeUndefined();
  });

  it('SEC-09: rejects a made-up token', async () => {
    const { body } = await createTrip();

    const res = await api()
      .get(`/api/trips/${body.trip.tripId}`)
      .set('X-Member-Token', 'x'.repeat(43));

    expect(res.status).toBe(401);
  });

  it('SEC-01: rejects a valid token used on a different trip', async () => {
    const mine = await createTrip();
    const other = await createTrip();

    const res = await api()
      .get(`/api/trips/${other.body.trip.tripId}`)
      .set('X-Member-Token', mine.body.memberToken);

    expect(res.status).toBe(401);
  });

  it('FR-32: rejects the token of a member who was removed', async () => {
    const { body } = await createTrip();
    const joined = await join(body.trip.tripId, 'Leaving');
    await ctx.db.query('delete from members where member_id = $1', [joined.body.member.memberId]);

    const res = await api()
      .get(`/api/trips/${body.trip.tripId}`)
      .set('X-Member-Token', joined.body.memberToken);

    expect(res.status).toBe(401);
  });

  it('SEC-08: rejects every token once the trip is deleted', async () => {
    const { body } = await createTrip();
    await ctx.db.query('delete from trips where trip_id = $1', [body.trip.tripId]);

    const res = await api()
      .get(`/api/trips/${body.trip.tripId}`)
      .set('X-Member-Token', body.memberToken);

    expect(res.status).toBe(401);
  });
});

describe('unknown routes', () => {
  it('returns a JSON 404', async () => {
    const res = await api().get('/api/nope');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });
});
