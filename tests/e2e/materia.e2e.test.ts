import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { MATERIAS } from '../../prisma/catalogo-materias';
import { createTestApp, tokenFor } from './app';

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;
let coord: string;
let docente: string;

const TEST_CLAVES = ['ZZA-9', 'ZZB-9', 'ZZC-9'];
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());
  coord = tokenFor(app, { rol: 'Coordinador' });
  docente = tokenFor(app, { rol: 'Docente' });
  await prisma.materia.deleteMany({ where: { clave: { in: TEST_CLAVES } } });
});

afterAll(async () => {
  await prisma.materia.deleteMany({ where: { clave: { in: TEST_CLAVES } } });
  await app.close();
});

describe('Autenticación / autorización del catálogo', () => {
  it('sin token ⇒ 401', async () => {
    await http.get('/api/materias').expect(401);
  });

  it('un Docente no puede crear materias ⇒ 403 (RF-CAT-06)', async () => {
    await http
      .post('/api/materias')
      .set(auth(docente))
      .send({ clave: 'ZZA-9', nombre: 'X', semestreAplicable: 1 })
      .expect(403);
  });
});

describe('GET /api/materias (autenticado)', () => {
  it('incluye las 33 materias del catálogo, todas activas', async () => {
    const res = await http.get('/api/materias').set(auth(coord)).expect(200);
    const claves: string[] = res.body.map((m: { clave: string }) => m.clave);
    for (const m of MATERIAS) expect(claves).toContain(m.clave);
    expect(res.body.every((m: { activo: boolean }) => m.activo === true)).toBe(true);
  });

  it('filtra por semestre', async () => {
    const res = await http.get('/api/materias?semestre=1').set(auth(coord)).expect(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every((m: { semestreAplicable: number }) => m.semestreAplicable === 1)).toBe(true);
  });
});

describe('POST /api/materias (Coordinador)', () => {
  it('crea una materia y la recupera por clave', async () => {
    const dto = { clave: 'ZZA-9', nombre: 'Materia de prueba', semestreAplicable: 3 };
    const created = await http.post('/api/materias').set(auth(coord)).send(dto).expect(201);
    expect(created.body.clave).toBe('ZZA-9');
    const got = await http.get('/api/materias/ZZA-9').set(auth(coord)).expect(200);
    expect(got.body.nombre).toBe('Materia de prueba');
  });

  it('rechaza clave inválida (400)', async () => {
    await http.post('/api/materias').set(auth(coord)).send({ clave: 'malformada', nombre: 'X', semestreAplicable: 1 }).expect(400);
  });

  it('rechaza semestre fuera de 1..6 (400)', async () => {
    await http.post('/api/materias').set(auth(coord)).send({ clave: 'ZZB-9', nombre: 'X', semestreAplicable: 7 }).expect(400);
  });

  it('rechaza propiedades no permitidas (400)', async () => {
    await http.post('/api/materias').set(auth(coord)).send({ clave: 'ZZC-9', nombre: 'X', semestreAplicable: 1, hack: true }).expect(400);
  });

  it('rechaza clave duplicada (409)', async () => {
    const dto = { clave: 'ZZB-9', nombre: 'Dup', semestreAplicable: 2 };
    await http.post('/api/materias').set(auth(coord)).send(dto).expect(201);
    await http.post('/api/materias').set(auth(coord)).send(dto).expect(409);
  });
});

describe('GET /api/materias/:clave', () => {
  it('responde 404 cuando no existe', async () => {
    await http.get('/api/materias/NOEXISTE-1').set(auth(coord)).expect(404);
  });
});

describe('DELETE /api/materias/:clave (borrado lógico)', () => {
  it('marca la materia inactiva y la oculta del listado por defecto', async () => {
    await http.post('/api/materias').set(auth(coord)).send({ clave: 'ZZC-9', nombre: 'A borrar', semestreAplicable: 4 }).expect(201);
    await http.delete('/api/materias/ZZC-9').set(auth(coord)).expect(200);

    const got = await http.get('/api/materias/ZZC-9').set(auth(coord)).expect(200);
    expect(got.body.activo).toBe(false);

    const porDefecto = await http.get('/api/materias').set(auth(coord));
    expect(porDefecto.body.map((m: { clave: string }) => m.clave)).not.toContain('ZZC-9');

    const conInactivas = await http.get('/api/materias?incluirInactivas=true').set(auth(coord));
    expect(conInactivas.body.map((m: { clave: string }) => m.clave)).toContain('ZZC-9');
  });

  it('incluirInactivas=false NO devuelve inactivas (FB-B-7, boolean de query explícito)', async () => {
    const res = await http.get('/api/materias?incluirInactivas=false').set(auth(coord)).expect(200);
    expect(res.body.map((m: { clave: string }) => m.clave)).not.toContain('ZZC-9');
  });
});
