import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
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
let operador: string;
let docTokenA: string; // propietario del curso
let docTokenB: string; // docente del MISMO plantel, NO propietario
let cursoId: string;
let grupoId: string;
let materiaId: string;
let periodoId: string;
let docenteAId: string;
let docenteBId: string;
let coordUsuarioBId: string;
let bloqueadoAEmail: string;
const usuarioIds: string[] = [];
const matriculas: string[] = [];

let n = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${n++}`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const CAD_1 = uniq('AZ1');

let diaP1: string;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  plantelA = (await prisma.plantel.findUniqueOrThrow({ where: { clave: 'BM' } })).id;
  plantelB = (await prisma.plantel.findUniqueOrThrow({ where: { clave: 'BC' } })).id;
  materiaId = (await prisma.materia.findUniqueOrThrow({ where: { clave: 'MAT-1' } })).id;
  coordA = tokenFor(app, { rol: 'Coordinador', plantelId: plantelA });
  coordB = tokenFor(app, { rol: 'Coordinador', plantelId: plantelB });
  operador = tokenFor(app, { rol: 'Operador', plantelId: null });

  const mkUsuario = async (rol: 'Docente' | 'Coordinador', plantelId: string, extra: object = {}) => {
    const u = await prisma.usuario.create({
      data: { email: uniq(rol.toLowerCase()) + '@sga.local', nombreCompleto: rol, rol, plantelId, hashContrasena: 'x', ...extra },
    });
    usuarioIds.push(u.id);
    return u;
  };

  const docenteA = await mkUsuario('Docente', plantelA);
  const docenteB = await mkUsuario('Docente', plantelA);
  docenteAId = docenteA.id;
  docenteBId = docenteB.id;
  docTokenA = tokenFor(app, { rol: 'Docente', plantelId: plantelA, sub: docenteA.id });
  docTokenB = tokenFor(app, { rol: 'Docente', plantelId: plantelA, sub: docenteB.id });

  const coordUsuarioB = await mkUsuario('Coordinador', plantelB);
  coordUsuarioBId = coordUsuarioB.id;

  // Usuario de plantel A bloqueado por intentos fallidos (para el desbloqueo cross-plantel).
  const bloqueado = await prisma.usuario.create({
    data: {
      email: uniq('lock') + '@sga.local',
      nombreCompleto: 'Bloqueado',
      rol: 'Docente',
      plantelId: plantelA,
      hashContrasena: await bcrypt.hash('Passw0rd!', 12),
      intentosFallidos: 5,
      bloqueadoHasta: new Date(Date.now() + 15 * 60_000),
    },
  });
  usuarioIds.push(bloqueado.id);
  bloqueadoAEmail = bloqueado.email;

  const grupo = await prisma.grupo.create({ data: { plantelId: plantelA, nombre: uniq('G'), semestre: 1 } });
  grupoId = grupo.id;
  const periodo = await prisma.periodo.create({
    data: { plantelId: plantelA, codigo: uniq('P'), fechaInicio: new Date('2025-08-01'), fechaFin: new Date('2026-06-30') },
  });
  periodoId = periodo.id;

  const curso = await http
    .post('/api/cursos')
    .set(auth(coordA))
    .send({ materiaId, grupoId, docenteId: docenteA.id, periodoId })
    .expect(201);
  cursoId = curso.body.id;

  const p1 = await prisma.parcial.findUniqueOrThrow({ where: { cursoId_numero: { cursoId, numero: 1 } } });
  diaP1 = new Date(p1.fechaInicio!).toISOString().slice(0, 10);

  await prisma.cadete.create({ data: { matricula: CAD_1, nombreCompleto: CAD_1, plantelId: plantelA, grupoActualId: grupoId, estatus: 'Activo' } });
  matriculas.push(CAD_1);
});

afterAll(async () => {
  await prisma.examen.deleteMany({ where: { parcial: { cursoId } } });
  await prisma.asistencia.deleteMany({ where: { cursoId } });
  await prisma.calificacion.deleteMany({ where: { actividad: { parcial: { cursoId } } } });
  await prisma.actividad.deleteMany({ where: { parcial: { cursoId } } });
  await prisma.cadete.deleteMany({ where: { matricula: { in: matriculas } } });
  await prisma.criterio.deleteMany({ where: { parcial: { cursoId } } });
  await prisma.parcial.deleteMany({ where: { cursoId } });
  await prisma.curso.deleteMany({ where: { id: cursoId } });
  await prisma.grupo.deleteMany({ where: { id: grupoId } });
  await prisma.periodo.deleteMany({ where: { id: periodoId } });
  await prisma.usuario.deleteMany({ where: { id: { in: usuarioIds } } });
  await app.close();
});

describe('FB-B-6 — Propiedad del curso: un Docente solo escribe en cursos propios', () => {
  it('Docente NO propietario no puede capturar asistencia (403)', async () => {
    await http
      .post(`/api/cursos/${cursoId}/asistencia`)
      .set(auth(docTokenB))
      .send({ fecha: diaP1, registros: [{ cadeteMatricula: CAD_1, codigo: 'A' }] })
      .expect(403);
  });

  it('Docente NO propietario no puede crear actividades ni capturar calificaciones (403)', async () => {
    await http
      .post(`/api/cursos/${cursoId}/parciales/1/actividades`)
      .set(auth(docTokenB))
      .send({ tipo: 'TI', nombre: 'TI intruso' })
      .expect(403);
    const act = await http
      .post(`/api/cursos/${cursoId}/parciales/1/actividades`)
      .set(auth(docTokenA))
      .send({ tipo: 'TI', nombre: 'TI legítima' })
      .expect(201);
    await http
      .post(`/api/cursos/${cursoId}/actividades/${act.body.id}/calificaciones`)
      .set(auth(docTokenB))
      .send({ registros: [{ cadeteMatricula: CAD_1, valor: 8 }] })
      .expect(403);
  });

  it('Docente NO propietario no puede capturar examen, punto extra ni cerrar (403)', async () => {
    await http
      .post(`/api/cursos/${cursoId}/parciales/1/examen`)
      .set(auth(docTokenB))
      .send({ registros: [{ cadeteMatricula: CAD_1, valor: 8 }] })
      .expect(403);
    await http
      .patch(`/api/cursos/${cursoId}/parciales/1/punto-extra`)
      .set(auth(docTokenB))
      .send({ registros: [{ cadeteMatricula: CAD_1, aplica: true }] })
      .expect(403);
    await http.post(`/api/cursos/${cursoId}/parciales/1/cerrar`).set(auth(docTokenB)).expect(403);
  });

  it('Docente NO propietario no puede firmar el acta ni capturar recuperación (403)', async () => {
    await http.post(`/api/cursos/${cursoId}/acta/firmar`).set(auth(docTokenB)).expect(403);
    await http
      .post(`/api/cursos/${cursoId}/acta/recuperacion`)
      .set(auth(docTokenB))
      .send({ cadeteMatricula: CAD_1, tipo: 'Ordinario', valor: 8 })
      .expect(403);
  });

  it('el propietario y Coordinación siguen pudiendo escribir', async () => {
    await http
      .post(`/api/cursos/${cursoId}/asistencia`)
      .set(auth(docTokenA))
      .send({ fecha: diaP1, registros: [{ cadeteMatricula: CAD_1, codigo: 'A' }] })
      .expect(200);
    await http
      .post(`/api/cursos/${cursoId}/asistencia`)
      .set(auth(coordA))
      .send({ fecha: diaP1, registros: [{ cadeteMatricula: CAD_1, codigo: 'A' }] })
      .expect(200);
    // Las lecturas del Docente sobre cursos del plantel quedan como hoy.
    await http.get(`/api/cursos/${cursoId}/parciales/1/calculo`).set(auth(docTokenB)).expect(200);
  });
});

describe('FB-B-6 — Desbloqueo scoped por plantel', () => {
  it('un Coordinador de otro plantel no puede desbloquear (403)', async () => {
    await http.post('/api/auth/desbloquear').set(auth(coordB)).send({ email: bloqueadoAEmail }).expect(403);
  });

  it('el Coordinador del plantel sí desbloquea (200)', async () => {
    await http.post('/api/auth/desbloquear').set(auth(coordA)).send({ email: bloqueadoAEmail }).expect(200);
  });
});

describe('FB-B-6 — Bitácora scoped por plantel para Coordinador', () => {
  let entidadId: string;

  beforeAll(async () => {
    entidadId = uniq('SCOPE');
    await prisma.auditLog.create({
      data: { tipoEvento: 'TEST_SCOPE', usuarioId: docenteAId, entidad: 'Parcial', entidadId },
    });
  });

  it('el Coordinador de otro plantel NO ve eventos de autores de plantel ajeno', async () => {
    const res = await http.get(`/api/bitacora?entidadId=${entidadId}`).set(auth(coordB)).expect(200);
    expect(res.body).toHaveLength(0);
  });

  it('el Coordinador del plantel del autor sí lo ve; el Operador es global', async () => {
    const deA = await http.get(`/api/bitacora?entidadId=${entidadId}`).set(auth(coordA)).expect(200);
    expect(deA.body).toHaveLength(1);
    const global = await http.get(`/api/bitacora?entidadId=${entidadId}`).set(auth(operador)).expect(200);
    expect(global.body).toHaveLength(1);
  });

  it('el export CSV aplica el mismo scoping', async () => {
    const res = await http.get(`/api/bitacora/export?entidadId=${entidadId}`).set(auth(coordB)).expect(200);
    expect(res.text).not.toContain('TEST_SCOPE');
  });
});

describe('FB-B-6 — Crear curso valida rol y plantel del docente', () => {
  it('rechaza un docenteId que no tiene rol Docente (400)', async () => {
    await http
      .post('/api/cursos')
      .set(auth(coordB))
      .send({ materiaId, grupoId: 'x', docenteId: coordUsuarioBId, periodoId: 'x' })
      .expect(404); // grupo inexistente responde antes; el caso real va abajo
    const grupoB = await prisma.grupo.create({ data: { plantelId: plantelB, nombre: uniq('GB'), semestre: 1 } });
    const periodoB = await prisma.periodo.create({
      data: { plantelId: plantelB, codigo: uniq('PB'), fechaInicio: new Date('2025-08-01'), fechaFin: new Date('2026-06-30') },
    });
    await http
      .post('/api/cursos')
      .set(auth(coordB))
      .send({ materiaId, grupoId: grupoB.id, docenteId: coordUsuarioBId, periodoId: periodoB.id })
      .expect(400);
    // Docente de plantel A en grupo de plantel B → 400.
    await http
      .post('/api/cursos')
      .set(auth(coordB))
      .send({ materiaId, grupoId: grupoB.id, docenteId: docenteBId, periodoId: periodoB.id })
      .expect(400);
    await prisma.periodo.delete({ where: { id: periodoB.id } });
    await prisma.grupo.delete({ where: { id: grupoB.id } });
  });
});
