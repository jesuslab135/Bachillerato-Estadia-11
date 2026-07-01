import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp, tokenFor } from './app';

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;

let plantelA: string;
let plantelB: string;
let coordA: string;
let coordB: string;
let docA: string;
let grupoA: string;
let grupoB: string;
const matriculas: string[] = [];
const grupoIds: string[] = [];

let n = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${n++}`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const track = (m: string) => {
  matriculas.push(m);
  return m;
};

const EXIST = track(uniq('EXIST'));
const V1 = track(uniq('V1'));
const V2 = track(uniq('V2'));
const CSVCAD = track(uniq('CSV'));

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  plantelA = (await prisma.plantel.findUniqueOrThrow({ where: { clave: 'BM' } })).id;
  plantelB = (await prisma.plantel.findUniqueOrThrow({ where: { clave: 'BC' } })).id;
  coordA = tokenFor(app, { rol: 'Coordinador', plantelId: plantelA });
  coordB = tokenFor(app, { rol: 'Coordinador', plantelId: plantelB });
  docA = tokenFor(app, { rol: 'Docente', plantelId: plantelA });

  grupoA = (await prisma.grupo.create({ data: { plantelId: plantelA, nombre: uniq('GA'), semestre: 1 } })).id;
  grupoB = (await prisma.grupo.create({ data: { plantelId: plantelB, nombre: uniq('GB'), semestre: 1 } })).id;
  grupoIds.push(grupoA, grupoB);

  await prisma.cadete.create({ data: { matricula: EXIST, nombreCompleto: 'Ya existe', plantelId: plantelA, grupoActualId: grupoA } });
});

afterAll(async () => {
  await prisma.cadete.deleteMany({ where: { matricula: { in: matriculas } } });
  await prisma.grupo.deleteMany({ where: { id: { in: grupoIds } } });
  await app.close();
});

describe('Cadete CRUD (scope por plantel, RF-AUTH-03)', () => {
  it('crea un cadete y lo lista dentro del plantel', async () => {
    await http.post('/api/cadetes').set(auth(coordA)).send({ matricula: V1, nombreCompleto: 'Uno', grupoId: grupoA }).expect(201);
    const res = await http.get(`/api/cadetes?grupoId=${grupoA}`).set(auth(coordA)).expect(200);
    expect(res.body.map((c: { matricula: string }) => c.matricula)).toContain(V1);
  });

  it('un Docente no puede crear cadetes (403)', async () => {
    await http.post('/api/cadetes').set(auth(docA)).send({ matricula: uniq('X'), nombreCompleto: 'X', grupoId: grupoA }).expect(403);
  });

  it('un Coordinador de otro plantel no puede crear en el grupo ajeno (403)', async () => {
    await http.post('/api/cadetes').set(auth(coordB)).send({ matricula: uniq('X'), nombreCompleto: 'X', grupoId: grupoA }).expect(403);
  });

  it('baja definitiva registra fecha de baja (RN-05)', async () => {
    await http.patch(`/api/cadetes/${V1}`).set(auth(coordA)).send({ estatus: 'BajaDefinitiva' }).expect(200);
    const cad = await prisma.cadete.findUniqueOrThrow({ where: { matricula: V1 } });
    expect(cad.estatus).toBe('BajaDefinitiva');
    expect(cad.fechaBaja).not.toBeNull();
  });
});

describe('Importación con éxito parcial (RF-CAT-07)', () => {
  it('inserta las válidas y reporta duplicadas/erróneas sin abortar', async () => {
    const res = await http
      .post('/api/cadetes/import')
      .set(auth(coordA))
      .send({
        registros: [
          { matricula: EXIST, nombreCompleto: 'Dup en DB', grupoId: grupoA }, // duplicada (ya existe)
          { matricula: uniq('BAD'), nombreCompleto: '', grupoId: grupoA }, // sin nombre
          { matricula: V2, nombreCompleto: 'Dos', grupoId: grupoA }, // válida
          { matricula: V2, nombreCompleto: 'Dos otra vez', grupoId: grupoA }, // duplicada en el lote
        ],
      })
      .expect(201);
    expect(res.body.insertados).toBe(1);
    expect(res.body.errores).toHaveLength(3);
    const cad = await prisma.cadete.findUnique({ where: { matricula: V2 } });
    expect(cad?.nombreCompleto).toBe('Dos');
  });

  it('acepta CSV y parsea filas', async () => {
    const csv = `matricula,nombreCompleto,grupoId\n${CSVCAD},Desde CSV,${grupoA}`;
    const res = await http.post('/api/cadetes/import').set(auth(coordA)).send({ csv }).expect(201);
    expect(res.body.insertados).toBe(1);
    const cad = await prisma.cadete.findUnique({ where: { matricula: CSVCAD } });
    expect(cad?.nombreCompleto).toBe('Desde CSV');
  });

  it('un Docente no puede importar (403)', async () => {
    await http.post('/api/cadetes/import').set(auth(docA)).send({ registros: [] }).expect(403);
  });
});
