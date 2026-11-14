const request = require('supertest');
const { createApp } = require('../src/app');

describe('GET /api/health', () => {
  it('reports the API is up and the database is not configured', async () => {
    const res = await request(createApp()).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', databaseConfigured: false });
  });

  it('returns 503 for data routes when no database is configured', async () => {
    const res = await request(createApp()).post('/api/trips').send({});

    expect(res.status).toBe(503);
  });
});
