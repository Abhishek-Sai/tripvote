const request = require('supertest');
const app = require('../src/app');

describe('GET /api/health', () => {
  it('reports the API is up', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.databaseConfigured).toBe('boolean');
  });
});
