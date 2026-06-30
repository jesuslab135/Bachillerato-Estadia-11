import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp, tokenFor } from './app';

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;

let plantelA: string; // Bordes Mangel
let plantelB: string; // Bonilla Colmenero
let materiaId: string;
let docenteId: string;
let operador: string;
let coordA: string;
let coordB: string;

let grupoA: string;
let periodoA: string;
const cursoIds: string[] = [];
const grupoIds: string[] = [];
const periodoIds: string[] = [];

let n = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${n++}`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  plantelA = (await prisma.plantel.findUniqueOrThrow({ where: { clave: 'BM' } })).id;
  plantelB = (await prisma.plantel.findUniqueOrThrow({ where: { clave: 'BC' } })).id;
  materiaId = (await prisma.materia.findUniqueOrThrow({ where: { clave: 'MAT-1' } })).id;
  const docente = await prisma.usuario.create({
    data: { email: uniq('doc') + '@sga.local', nombreCompleto: 'Docente E2E', rol: 'Docente', plantelId: plantelA, hashContrasena: 'x' },
  });
  docenteId = docente.id;

  operador = tokenFor(app, { rol: 'Operador', plantelId: null });
  coordA = tokenFor(app, { rol: 'Coordinador', plantelId: plantelA });
  coordB = tokenFor(app, { rol: 'Coordinador', plantelId: plantelB });

  const g = await prisma.grupo.create({ data: { plantelId: plantelA, nombre: uniq('G'), semestre: 1 } });
  grupoA = g.id;
  grupoIds.push(g.id);
  const p = await prisma.periodo.create({
    data: { plantelId: plantelA, codigo: uniq('P'), fechaInicio: new Date('2025-08-01'), fechaFin: new Date('2026-06-30') },
  });
  periodoA = p.id;
  periodoIds.push(p.id);
});

afterAll(async () => {
  await prisma.criterio.deleteMany({ where: { parcial: { cursoId: { in: cursoIds } } } });
  await prisma.parcial.deleteMany({ where: { cursoId: { in: cursoIds } } });
  await prisma.curso.deleteMany({ where: { id: { in: cursoIds } } });
  await prisma.grupo.deleteMany({ where: { id: { in: grupoIds } } });
  await prisma.periodo.deleteMany({ where: { id: { in: periodoIds } } });
  await prisma.usuario.deleteMany({ where: { id: docenteId } });
  await app.close();
});

describe('Asignación de cursos (RF-ASIG-01 / RF-ASIG-03)', () => {
  it('crear un curso instancia exactamente 3 parciales y 15 criterios por parcial', async () => {
    const dto = { materiaId, grupoId: grupoA, docenteId, periodoId: periodoA };
    const res = await http.post('/api/cursos').set(auth(coordA)).send(dto).expect(201);
    cursoIds.push(res.body.id);

    expect(res.body.parciales).toHaveLength(3);
    for (const p of res.body.parciales) expect(p._count.criterios).toBe(15);

    const totalCriterios = await prisma.criterio.count({ where: { parcial: { cursoId: res.body.id } } });
    expect(totalCriterios).toBe(45);
  });

  it('no se duplica la combinación Materia×Grupo×Docente×Periodo ⇒ 409', async () => {
    const dto = { materiaId, grupoId: grupoA, docenteId, periodoId: periodoA };
    await http.post('/api/cursos').set(auth(coordA)).send(dto).expect(409);
  });

  it('un Docente no puede crear cursos ⇒ 403 (RF-CAT-06)', async () => {
    const docToken = tokenFor(app, { rol: 'Docente', plantelId: plantelA });
    await http
      .post('/api/cursos')
      .set(auth(docToken))
      .send({ materiaId, grupoId: grupoA, docenteId, periodoId: periodoA })
      .expect(403);
  });
});

describe('Scoping por plantel (RF-AUTH-03)', () => {
  it('Coordinador de A ve el curso; Coordinador de B no; Operador sí', async () => {
    const cursoId = cursoIds[0];
    const idsDe = async (token: string) =>
      (await http.get('/api/cursos').set(auth(token))).body.map((c: { id: string }) => c.id);

    expect(await idsDe(coordA)).toContain(cursoId);
    expect(await idsDe(coordB)).not.toContain(cursoId);
    expect(await idsDe(operador)).toContain(cursoId);
  });

  it('un Coordinador no puede crear un grupo en otro plantel ⇒ 403', async () => {
    await http
      .post('/api/grupos')
      .set(auth(coordB))
      .send({ plantelId: plantelA, nombre: uniq('G'), semestre: 2 })
      .expect(403);
  });
});

describe('Activación de periodo (RF-CAT-04)', () => {
  it('activar un periodo desactiva el anterior del mismo plantel', async () => {
    const p1 = await http
      .post('/api/periodos')
      .set(auth(coordA))
      .send({ plantelId: plantelA, codigo: uniq('PA'), fechaInicio: '2024-08-01', fechaFin: '2025-06-30' })
      .expect(201);
    const p2 = await http
      .post('/api/periodos')
      .set(auth(coordA))
      .send({ plantelId: plantelA, codigo: uniq('PB'), fechaInicio: '2025-08-01', fechaFin: '2026-06-30' })
      .expect(201);
    periodoIds.push(p1.body.id, p2.body.id);

    await http.post(`/api/periodos/${p1.body.id}/activar`).set(auth(coordA)).expect(200);
    await http.post(`/api/periodos/${p2.body.id}/activar`).set(auth(coordA)).expect(200);

    const a1 = await prisma.periodo.findUniqueOrThrow({ where: { id: p1.body.id } });
    const a2 = await prisma.periodo.findUniqueOrThrow({ where: { id: p2.body.id } });
    expect(a1.activo).toBe(false);
    expect(a2.activo).toBe(true);

    const activos = await prisma.periodo.count({ where: { plantelId: plantelA, activo: true } });
    expect(activos).toBe(1);
  });
});

describe('Alta de plantel (RF-CAT-01)', () => {
  it('solo el Operador puede crear planteles', async () => {
    await http.post('/api/planteles').set(auth(coordA)).send({ clave: uniq('PL'), nombre: 'X' }).expect(403);
    const ok = await http.post('/api/planteles').set(auth(operador)).send({ clave: uniq('PL'), nombre: 'Nuevo Plantel' }).expect(201);
    expect(ok.body.clave).toBeTruthy();
  });
});
