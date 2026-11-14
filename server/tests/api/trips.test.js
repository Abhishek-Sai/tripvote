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

describe('unknown routes', () => {
  it('returns a JSON 404', async () => {
    const res = await api().get('/api/nope');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });
});
