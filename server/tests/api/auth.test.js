const express = require('express');
const request = require('supertest');
const { errorHandler } = require('../../src/app');
const { requireMember, requireOrganizer } = require('../../src/middleware/auth');
const { createTestApp } = require('./apiTestApp');

// No organizer-only route exists yet, so this mounts a stand-in route behind the
// real middleware to test FR-19 / SEC-02 now.
let ctx;
let app;
beforeAll(async () => {
  ctx = await createTestApp();
  app = express();
  app.post('/trips/:tripId/organizer-action', requireMember(ctx.db), requireOrganizer, (req, res) =>
    res.json({ ok: true }),
  );
  app.use(errorHandler);
});
afterAll(() => ctx.close());

async function tripWithMember() {
  const created = await request(ctx.app)
    .post('/api/trips')
    .send({ name: 'Trip', organizerName: 'Organizer' });
  const joined = await request(ctx.app)
    .post(`/api/trips/${created.body.trip.tripId}/members`)
    .send({ displayName: 'Member' });
  return {
    tripId: created.body.trip.tripId,
    organizerToken: created.body.memberToken,
    memberToken: joined.body.memberToken,
  };
}

const organizerAction = (tripId, headers) => {
  const req = request(app).post(`/trips/${tripId}/organizer-action`);
  for (const [name, value] of Object.entries(headers)) req.set(name, value);
  return req;
};

describe('requireOrganizer (FR-19, SEC-02)', () => {
  it('allows the organizer sending their token in both headers', async () => {
    const { tripId, organizerToken } = await tripWithMember();

    const res = await organizerAction(tripId, {
      'X-Member-Token': organizerToken,
      'X-Organizer-Token': organizerToken,
    });

    expect(res.status).toBe(200);
  });

  it('returns 403 to a regular member', async () => {
    const { tripId, memberToken } = await tripWithMember();

    const res = await organizerAction(tripId, {
      'X-Member-Token': memberToken,
      'X-Organizer-Token': memberToken,
    });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('returns 403 to the organizer without the X-Organizer-Token header', async () => {
    const { tripId, organizerToken } = await tripWithMember();

    const res = await organizerAction(tripId, { 'X-Member-Token': organizerToken });

    expect(res.status).toBe(403);
  });

  it('returns 403 when a member sends the organizer token only as X-Organizer-Token', async () => {
    const { tripId, organizerToken, memberToken } = await tripWithMember();

    const res = await organizerAction(tripId, {
      'X-Member-Token': memberToken,
      'X-Organizer-Token': organizerToken,
    });

    expect(res.status).toBe(403);
  });

  it('returns 401 before the organizer check when the member token is invalid', async () => {
    const { tripId, organizerToken } = await tripWithMember();

    const res = await organizerAction(tripId, {
      'X-Member-Token': 'bad',
      'X-Organizer-Token': organizerToken,
    });

    expect(res.status).toBe(401);
  });
});
