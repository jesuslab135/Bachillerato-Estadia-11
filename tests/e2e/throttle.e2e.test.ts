import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Se fija un límite bajo ANTES de construir la app para ejercitar el rate-limit (RNF-SEC).
// Nota (FB-B-5): el login tiene su propio límite (THROTTLE_LOGIN_LIMIT), por eso el límite
// GLOBAL se ejercita aquí contra un endpoint autenticado normal.
let app: INestApplication;
let http: ReturnType<typeof request>;
let token: string;

beforeAll(async () => {
  process.env.THROTTLE_LIMIT = '3';
  process.env.THROTTLE_TTL = '60000';
  const { createTestApp, tokenFor } = await import('./app');
  app = await createTestApp();
  http = request(app.getHttpServer());
  token = tokenFor(app, { rol: 'Coordinador' });
});

afterAll(async () => {
  delete process.env.THROTTLE_LIMIT;
  delete process.env.THROTTLE_TTL;
  await app.close();
});

describe('Rate-limiting por IP (RNF-SEC)', () => {
  it('bloquea con 429 al superar el límite global de solicitudes', async () => {
    const enviar = () => http.get('/api/materias').set({ Authorization: `Bearer ${token}` });
    // Con límite 3: las primeras 3 pasan (200), la 4ª se bloquea (429).
    await enviar().expect(200);
    await enviar().expect(200);
    await enviar().expect(200);
    const res = await enviar();
    expect(res.status).toBe(429);
  });
});
