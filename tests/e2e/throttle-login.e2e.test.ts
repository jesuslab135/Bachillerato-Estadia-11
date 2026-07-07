import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// FB-B-5 — límite de throttling específico del login (anti fuerza bruta / spraying).
// Se fija un límite bajo ANTES de construir la app; el límite del login es resolvable
// (lee THROTTLE_LOGIN_LIMIT en tiempo de request).
let app: INestApplication;
let http: ReturnType<typeof request>;

beforeAll(async () => {
  process.env.THROTTLE_LOGIN_LIMIT = '3';
  const { createTestApp } = await import('./app');
  app = await createTestApp();
  http = request(app.getHttpServer());
});

afterAll(async () => {
  delete process.env.THROTTLE_LOGIN_LIMIT;
  await app.close();
});

describe('Throttle del login (FB-B-5, RNF-SEC)', () => {
  it('bloquea el login con 429 al superar su límite propio aunque el global sea alto', async () => {
    const enviar = () => http.post('/api/auth/login').send({ email: 'spray@sga.local', password: 'nope' });
    // Límite 3: las primeras 3 pasan (401 credenciales), la 4ª se bloquea (429).
    await enviar().expect(401);
    await enviar().expect(401);
    await enviar().expect(401);
    const res = await enviar();
    expect(res.status).toBe(429);
  });
});
