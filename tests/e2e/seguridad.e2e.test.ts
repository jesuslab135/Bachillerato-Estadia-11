import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './app';

describe('Cabeceras de seguridad (helmet, RNF-SEC)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    app = await createTestApp();
    http = request(app.getHttpServer());
  });
  afterAll(async () => {
    await app.close();
  });

  it('responde con cabeceras de seguridad de helmet', async () => {
    const res = await http.post('/api/auth/login').send({ email: 'x@sga.local', password: 'nope' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-dns-prefetch-control']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined(); // helmet oculta la firma de Express
  });
});
