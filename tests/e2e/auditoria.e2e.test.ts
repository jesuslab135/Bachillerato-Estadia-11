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
let cursoId: string;
let grupoId: string;
let periodoId: string;
let docenteId: string;
let parcial1Id: string;
let actividadId: string;
const matriculas: string[] = [];

let n = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${n++}`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const CAD_1 = uniq('AUD');
let diaP1: string;

const bitacoraDe = (tipoEvento: string, entidadId: string) =>
  prisma.auditLog.findMany({ where: { tipoEvento, entidadId }, orderBy: { timestamp: 'asc' } });

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  plantelA = (await prisma.plantel.findUniqueOrThrow({ where: { clave: 'BM' } })).id;
  const materiaId = (await prisma.materia.findUniqueOrThrow({ where: { clave: 'MAT-1' } })).id;
  coordA = tokenFor(app, { rol: 'Coordinador', plantelId: plantelA });

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
  const p1 = await prisma.parcial.findUniqueOrThrow({ where: { cursoId_numero: { cursoId, numero: 1 } } });
  parcial1Id = p1.id;
  diaP1 = new Date(p1.fechaInicio!).toISOString().slice(0, 10);

  await prisma.cadete.create({ data: { matricula: CAD_1, nombreCompleto: CAD_1, plantelId: plantelA, grupoActualId: grupoId, estatus: 'Activo' } });
  matriculas.push(CAD_1);

  const act = await http
    .post(`/api/cursos/${cursoId}/parciales/1/actividades`)
    .set(auth(coordA))
    .send({ tipo: 'TI', nombre: 'TI auditada' })
    .expect(201);
  actividadId = act.body.id;
});

afterAll(async () => {
  await prisma.examen.deleteMany({ where: { parcial: { cursoId } } });
  await prisma.calificacion.deleteMany({ where: { actividad: { parcial: { cursoId } } } });
  await prisma.puntoExtra.deleteMany({ where: { parcial: { cursoId } } });
  await prisma.asistencia.deleteMany({ where: { cursoId } });
  await prisma.actividad.deleteMany({ where: { parcial: { cursoId } } });
  await prisma.cadete.deleteMany({ where: { matricula: { in: matriculas } } });
  await prisma.criterio.deleteMany({ where: { parcial: { cursoId } } });
  await prisma.parcial.deleteMany({ where: { cursoId } });
  await prisma.curso.deleteMany({ where: { id: cursoId } });
  await prisma.grupo.deleteMany({ where: { id: grupoId } });
  await prisma.periodo.deleteMany({ where: { id: periodoId } });
  await prisma.usuario.deleteMany({ where: { id: docenteId } });
  await app.close();
});

describe('FB-B-9 — Auditoría de cambios de asistencia (RN-01 trazable)', () => {
  const capturar = (codigo: string) =>
    http
      .post(`/api/cursos/${cursoId}/asistencia`)
      .set(auth(coordA))
      .send({ fecha: diaP1, registros: [{ cadeteMatricula: CAD_1, codigo }] })
      .expect(200);
  const filaAsistencia = () =>
    prisma.asistencia.findUniqueOrThrow({
      where: { cadeteMatricula_cursoId_fecha: { cadeteMatricula: CAD_1, cursoId, fecha: new Date(diaP1) } },
    });

  it('la captura inicial y el upsert idéntico NO generan ruido en bitácora', async () => {
    await capturar('F');
    await capturar('F');
    const fila = await filaAsistencia();
    expect(await bitacoraDe('ASISTENCIA_CAMBIO_CODIGO', fila.id)).toHaveLength(0);
  });

  it('el cambio F→J deja rastro con valor viejo→nuevo y autor', async () => {
    await capturar('J');
    const fila = await filaAsistencia();
    const eventos = await bitacoraDe('ASISTENCIA_CAMBIO_CODIGO', fila.id);
    expect(eventos).toHaveLength(1);
    expect(eventos[0].valorAnteriorJson).toMatchObject({ codigo: 'F' });
    expect(eventos[0].valorNuevoJson).toMatchObject({ codigo: 'J' });
    expect(eventos[0].usuarioId).toBeTruthy();
  });
});

describe('FB-B-9 — Auditoría de calificaciones / examen / punto extra', () => {
  const calificar = (valor: number) =>
    http
      .post(`/api/cursos/${cursoId}/actividades/${actividadId}/calificaciones`)
      .set(auth(coordA))
      .send({ registros: [{ cadeteMatricula: CAD_1, valor }] })
      .expect(200);

  it('captura, edición real y upsert idéntico de calificación', async () => {
    await calificar(8);
    const fila = await prisma.calificacion.findUniqueOrThrow({
      where: { cadeteMatricula_actividadId: { cadeteMatricula: CAD_1, actividadId } },
    });
    expect(await bitacoraDe('CALIFICACION_CAPTURA', fila.id)).toHaveLength(1);
    await calificar(8); // idéntico → sin ruido
    expect(await bitacoraDe('CALIFICACION_CAPTURA', fila.id)).toHaveLength(1);
    await calificar(9); // cambio real → viejo 8 → nuevo 9
    const eventos = await bitacoraDe('CALIFICACION_CAPTURA', fila.id);
    expect(eventos).toHaveLength(2);
    expect(eventos[1].valorAnteriorJson).toMatchObject({ valor: 8 });
    expect(eventos[1].valorNuevoJson).toMatchObject({ valor: 9 });
  });

  it('captura y edición de examen dejan rastro; idéntico no', async () => {
    const examen = (body: object) =>
      http
        .post(`/api/cursos/${cursoId}/parciales/1/examen`)
        .set(auth(coordA))
        .send({ registros: [{ cadeteMatricula: CAD_1, ...body }] })
        .expect(200);
    await examen({ valor: 7 });
    const fila = await prisma.examen.findUniqueOrThrow({
      where: { cadeteMatricula_parcialId_tipo: { cadeteMatricula: CAD_1, parcialId: parcial1Id, tipo: 'Parcial' } },
    });
    expect(await bitacoraDe('EXAMEN_CAPTURA', fila.id)).toHaveLength(1);
    await examen({ valor: 7 });
    expect(await bitacoraDe('EXAMEN_CAPTURA', fila.id)).toHaveLength(1);
    await examen({ np: true });
    const eventos = await bitacoraDe('EXAMEN_CAPTURA', fila.id);
    expect(eventos).toHaveLength(2);
    expect(eventos[1].valorAnteriorJson).toMatchObject({ valor: 7, estatus: 'PRESENTADO' });
    expect(eventos[1].valorNuevoJson).toMatchObject({ valor: null, estatus: 'NP' });
  });

  it('el punto extra deja rastro solo cuando cambia', async () => {
    const punto = (aplica: boolean) =>
      http
        .patch(`/api/cursos/${cursoId}/parciales/1/punto-extra`)
        .set(auth(coordA))
        .send({ registros: [{ cadeteMatricula: CAD_1, aplica }] })
        .expect(200);
    await punto(true);
    const fila = await prisma.puntoExtra.findUniqueOrThrow({
      where: { cadeteMatricula_parcialId: { cadeteMatricula: CAD_1, parcialId: parcial1Id } },
    });
    expect(await bitacoraDe('PUNTO_EXTRA_CAPTURA', fila.id)).toHaveLength(1);
    await punto(true);
    expect(await bitacoraDe('PUNTO_EXTRA_CAPTURA', fila.id)).toHaveLength(1);
    await punto(false);
    expect(await bitacoraDe('PUNTO_EXTRA_CAPTURA', fila.id)).toHaveLength(2);
  });
});

describe('FB-B-9 — crearActividad concurrente: P2002 → 409', () => {
  it('la colisión de orden responde 409, no 500', async () => {
    // count=1 para TA (fila directa con orden 2) → el servicio calcula orden 2 → P2002.
    await prisma.actividad.create({ data: { parcialId: parcial1Id, tipo: 'TA', orden: 2, nombre: 'TA directa' } });
    await http
      .post(`/api/cursos/${cursoId}/parciales/1/actividades`)
      .set(auth(coordA))
      .send({ tipo: 'TA', nombre: 'TA choca' })
      .expect(409);
  });
});
