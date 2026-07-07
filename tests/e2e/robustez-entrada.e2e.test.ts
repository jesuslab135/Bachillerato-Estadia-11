import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp, tokenFor } from './app';

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;

let plantelA: string;
let coordA: string;
let operador: string;
let cursoId: string;
let grupoId: string;
let periodoId: string;
let docenteId: string;
let parcial1Id: string;
let parcial2Id: string;

let n = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${n++}`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  plantelA = (await prisma.plantel.findUniqueOrThrow({ where: { clave: 'BM' } })).id;
  const materiaId = (await prisma.materia.findUniqueOrThrow({ where: { clave: 'MAT-1' } })).id;
  coordA = tokenFor(app, { rol: 'Coordinador', plantelId: plantelA });
  operador = tokenFor(app, { rol: 'Operador', plantelId: null });

  const docente = await prisma.usuario.create({
    data: { email: uniq('doc') + '@sga.local', nombreCompleto: 'Doc', rol: 'Docente', plantelId: plantelA, hashContrasena: 'x' },
  });
  docenteId = docente.id;
  const grupo = await prisma.grupo.create({ data: { plantelId: plantelA, nombre: uniq('G'), semestre: 1 } });
  grupoId = grupo.id;
  const periodo = await prisma.periodo.create({
    data: { plantelId: plantelA, codigo: uniq('P'), fechaInicio: new Date('2025-08-01'), fechaFin: new Date('2026-06-30') },
  });
  periodoId = periodo.id;

  const curso = await http
    .post('/api/cursos')
    .set(auth(coordA))
    .send({ materiaId, grupoId, docenteId, periodoId })
    .expect(201);
  cursoId = curso.body.id;
  parcial1Id = (await prisma.parcial.findUniqueOrThrow({ where: { cursoId_numero: { cursoId, numero: 1 } } })).id;
  parcial2Id = (await prisma.parcial.findUniqueOrThrow({ where: { cursoId_numero: { cursoId, numero: 2 } } })).id;
});

afterAll(async () => {
  await prisma.actividad.deleteMany({ where: { parcial: { cursoId } } });
  await prisma.criterio.deleteMany({ where: { parcial: { cursoId } } });
  await prisma.parcial.deleteMany({ where: { cursoId } });
  await prisma.curso.deleteMany({ where: { id: cursoId } });
  await prisma.grupo.deleteMany({ where: { id: grupoId } });
  await prisma.periodo.deleteMany({ where: { id: periodoId } });
  await prisma.usuario.deleteMany({ where: { id: docenteId } });
  await app.close();
});

describe('FB-B-7 — Fechas de query con DTO', () => {
  it('GET asistencia?fecha=basura responde 400 (no 500)', async () => {
    await http.get(`/api/cursos/${cursoId}/asistencia?fecha=basura`).set(auth(coordA)).expect(400);
  });

  it('GET asistencia sin fecha responde 400', async () => {
    await http.get(`/api/cursos/${cursoId}/asistencia`).set(auth(coordA)).expect(400);
  });

  it('GET asistencia con fecha válida sigue funcionando (200)', async () => {
    await http.get(`/api/cursos/${cursoId}/asistencia?fecha=2025-09-01`).set(auth(coordA)).expect(200);
  });
});

describe('FB-B-7 — Ventanas de parcial nulas: 409 explicativo, nunca 500', () => {
  it('resumen y cálculo responden 409 si el parcial no tiene ventana definida', async () => {
    await prisma.parcial.update({ where: { id: parcial1Id }, data: { fechaInicio: null, fechaFin: null } });
    await http.get(`/api/cursos/${cursoId}/parciales/1/resumen`).set(auth(coordA)).expect(409);
    await http.get(`/api/cursos/${cursoId}/parciales/1/calculo`).set(auth(coordA)).expect(409);
    // restaurar para no contaminar otros casos
    await prisma.parcial.update({
      where: { id: parcial1Id },
      data: { fechaInicio: new Date('2025-08-01'), fechaFin: new Date('2025-11-15') },
    });
  });
});

describe('FB-B-7 — criterioId debe pertenecer al parcial destino', () => {
  it('rechaza una actividad con criterio de OTRO parcial (400)', async () => {
    const criterioDeP2 = await prisma.criterio.findFirstOrThrow({ where: { parcialId: parcial2Id } });
    await http
      .post(`/api/cursos/${cursoId}/parciales/1/actividades`)
      .set(auth(coordA))
      .send({ tipo: 'TI', nombre: 'TI cruzada', criterioId: criterioDeP2.id })
      .expect(400);
  });

  it('acepta una actividad con criterio del MISMO parcial (201)', async () => {
    const criterioDeP1 = await prisma.criterio.findFirstOrThrow({ where: { parcialId: parcial1Id, tipo: 'TI' } });
    await http
      .post(`/api/cursos/${cursoId}/parciales/1/actividades`)
      .set(auth(coordA))
      .send({ tipo: 'TI', nombre: 'TI propia', criterioId: criterioDeP1.id })
      .expect(201);
  });
});

describe('FB-B-7 — Export de bitácora inmune a inyección de fórmulas', () => {
  it("prefija con ' las celdas que empiezan con = + - @", async () => {
    const entidadId = uniq('FORMULA');
    await prisma.auditLog.create({
      data: { tipoEvento: 'TEST_FORMULA', entidad: '=SUM(A1:A9)', entidadId },
    });
    const res = await http.get(`/api/bitacora/export?entidadId=${entidadId}`).set(auth(operador)).expect(200);
    expect(res.text).toContain("'=SUM(A1:A9)");
    expect(res.text).not.toContain(',=SUM(A1:A9)');
  });
});
