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
let cursoId: string;
let grupoId: string;
const periodoIds: string[] = [];
const grupoIds: string[] = [];
const matriculas: string[] = [];
let docenteId: string;

let n = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${n++}`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const CAD_A = uniq('CADA');
const CAD_B = uniq('CADB');
const CAD_OTRO = uniq('CADX'); // otro grupo
const CAD_BAJA = uniq('CADBD'); // baja definitiva

let dia: (offset: number) => string;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  plantelA = (await prisma.plantel.findUniqueOrThrow({ where: { clave: 'BM' } })).id;
  plantelB = (await prisma.plantel.findUniqueOrThrow({ where: { clave: 'BC' } })).id;
  const materiaId = (await prisma.materia.findUniqueOrThrow({ where: { clave: 'MAT-1' } })).id;
  coordA = tokenFor(app, { rol: 'Coordinador', plantelId: plantelA });
  coordB = tokenFor(app, { rol: 'Coordinador', plantelId: plantelB });

  const docente = await prisma.usuario.create({
    data: { email: uniq('doc') + '@sga.local', nombreCompleto: 'Doc', rol: 'Docente', plantelId: plantelA, hashContrasena: 'x' },
  });
  docenteId = docente.id;
  const grupo = await prisma.grupo.create({ data: { plantelId: plantelA, nombre: uniq('G'), semestre: 1 } });
  grupoId = grupo.id;
  grupoIds.push(grupo.id);
  const otroGrupo = await prisma.grupo.create({ data: { plantelId: plantelA, nombre: uniq('G'), semestre: 1 } });
  grupoIds.push(otroGrupo.id);
  const periodo = await prisma.periodo.create({
    data: { plantelId: plantelA, codigo: uniq('P'), fechaInicio: new Date('2025-08-01'), fechaFin: new Date('2026-06-30') },
  });
  periodoIds.push(periodo.id);

  const curso = await http
    .post('/api/cursos')
    .set(auth(coordA))
    .send({ materiaId, grupoId, docenteId, periodoId: periodo.id })
    .expect(201);
  cursoId = curso.body.id;

  const p1 = await prisma.parcial.findUniqueOrThrow({ where: { cursoId_numero: { cursoId, numero: 1 } } });
  const base = new Date(p1.fechaInicio!).getTime();
  dia = (offset) => new Date(base + offset * 86_400_000).toISOString().slice(0, 10);

  for (const [mat, grp, estatus] of [
    [CAD_A, grupoId, 'Activo'],
    [CAD_B, grupoId, 'Activo'],
    [CAD_OTRO, otroGrupo.id, 'Activo'],
    [CAD_BAJA, grupoId, 'BajaDefinitiva'],
  ] as const) {
    await prisma.cadete.create({
      data: { matricula: mat, nombreCompleto: mat, plantelId: plantelA, grupoActualId: grp, estatus },
    });
    matriculas.push(mat);
  }
});

afterAll(async () => {
  await prisma.asistencia.deleteMany({ where: { cursoId } });
  await prisma.cadete.deleteMany({ where: { matricula: { in: matriculas } } });
  await prisma.criterio.deleteMany({ where: { parcial: { cursoId } } });
  await prisma.parcial.deleteMany({ where: { cursoId } });
  await prisma.curso.deleteMany({ where: { id: cursoId } });
  await prisma.grupo.deleteMany({ where: { id: { in: grupoIds } } });
  await prisma.periodo.deleteMany({ where: { id: { in: periodoIds } } });
  await prisma.usuario.deleteMany({ where: { id: docenteId } });
  await app.close();
});

const capturar = (token: string, fecha: string, registros: { cadeteMatricula: string; codigo: string }[]) =>
  http.post(`/api/cursos/${cursoId}/asistencia`).set(auth(token)).send({ fecha, registros });

const filaDe = async (mat: string) => {
  const res = await http.get(`/api/cursos/${cursoId}/parciales/1/resumen`).set(auth(coordA)).expect(200);
  return res.body.cadetes.find((c: { matricula: string }) => c.matricula === mat);
};

describe('Captura de asistencia + SDE (RN-01)', () => {
  it('captura válida y contadores en tiempo real (RF-ASIS-03)', async () => {
    await capturar(coordA, dia(0), [
      { cadeteMatricula: CAD_A, codigo: 'A' },
      { cadeteMatricula: CAD_B, codigo: 'A' },
    ]).expect(200);
    const fila = await filaDe(CAD_A);
    expect(fila.asistencias).toBe(1);
    expect(fila.sde).toBe(false);
    expect(fila.tieneDerechoExamen).toBe(true);
  });

  it('la 3ª falta no justificada marca SDE (RF-ASIS-04)', async () => {
    await capturar(coordA, dia(0), [{ cadeteMatricula: CAD_A, codigo: 'F' }]).expect(200);
    await capturar(coordA, dia(1), [{ cadeteMatricula: CAD_A, codigo: 'F' }]).expect(200);
    await capturar(coordA, dia(2), [{ cadeteMatricula: CAD_A, codigo: 'F' }]).expect(200);
    const fila = await filaDe(CAD_A);
    expect(fila.faltas).toBe(3);
    expect(fila.sde).toBe(true);
    expect(fila.tieneDerechoExamen).toBe(false);
  });

  it('cambiar F→J reevalúa y restituye el derecho (RF-ASIS-08)', async () => {
    await capturar(coordA, dia(0), [{ cadeteMatricula: CAD_A, codigo: 'J' }]).expect(200);
    const fila = await filaDe(CAD_A);
    expect(fila.faltas).toBe(2);
    expect(fila.justificadas).toBe(1);
    expect(fila.sde).toBe(false);
  });

  it('el retardo no cuenta como falta', async () => {
    await capturar(coordA, dia(3), [{ cadeteMatricula: CAD_B, codigo: 'R' }]).expect(200);
    const fila = await filaDe(CAD_B);
    expect(fila.retardos).toBe(1);
    expect(fila.faltas).toBe(0);
    expect(fila.sde).toBe(false);
  });
});

describe('Validaciones de captura', () => {
  it('rechaza código inválido (400)', async () => {
    await capturar(coordA, dia(0), [{ cadeteMatricula: CAD_A, codigo: 'Z' }]).expect(400);
  });

  it('rechaza cadete de otro grupo (400)', async () => {
    await capturar(coordA, dia(0), [{ cadeteMatricula: CAD_OTRO, codigo: 'A' }]).expect(400);
  });

  it('rechaza cadete en baja definitiva (RN-05) (400)', async () => {
    await capturar(coordA, dia(0), [{ cadeteMatricula: CAD_BAJA, codigo: 'A' }]).expect(400);
  });

  it('un Coordinador de otro plantel no puede capturar (403, RF-AUTH-03)', async () => {
    await capturar(coordB, dia(0), [{ cadeteMatricula: CAD_A, codigo: 'A' }]).expect(403);
  });
});
