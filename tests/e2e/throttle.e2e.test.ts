import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Se fija un límite bajo ANTES de construir la app para ejercitar el rate-limit (RNF-SEC).
let app: INestApplication;
let http: ReturnType<typeof request>;
let createTestApp: () => Promise<INestApplication>;

beforeAll(async () => {
  process.env.THROTTLE_LIMIT = '3';
  process.env.THROTTLE_TTL = '60000';
  ({ createTestApp } = await import('./app'));
  app = await createTestApp();
  http = request(app.getHttpServer());
});

afterAll(async () => {
  delete process.env.THROTTLE_LIMIT;
  delete process.env.THROTTLE_TTL;
  await app.close();
});

describe('Rate-limiting por IP (RNF-SEC)', () => {
  it('bloquea con 429 al superar el límite de solicitudes', async () => {
    const enviar = () => http.post('/api/auth/login').send({ email: 'rate@sga.local', password: 'nope' });
    // Con límite 3: las primeras 3 pasan (401 credenciales), la 4ª se bloquea (429).
    await enviar();
    await enviar();
    await enviar();
    const res = await enviar();
    expect(res.status).toBe(429);
  });
});
