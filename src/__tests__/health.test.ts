import request from 'supertest';
import app from '../app';

describe('GET /health', () => {
  it('should return 200 OK and status ok in JSON format', async () => {
    const response = await request(app)
      .get('/health')
      .expect('Content-Type', /json/)
      .expect(200);

    expect(response.body).toEqual({ status: 'ok' });
  });
});
