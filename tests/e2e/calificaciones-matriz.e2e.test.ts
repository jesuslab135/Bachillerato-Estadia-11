import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp, tokenFor } from './app';

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;

let coordA: string;
let cursoId: string;
let docenteId: string;
const cleanup: { grupoIds: string[]; periodoIds: string[]; matriculas: string[] } = { grupoIds: [], periodoIds: [], matriculas: [] };

let nn = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${nn++}`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const CAD = uniq('CADM');

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  const plantelA = (await prisma.plantel.findUniqueOrThrow({ where: { clave: 'BM' } })).id;
  const materiaId = (await prisma.materia.findUniqueOrThrow({ where: { clave: 'MAT-1' } })).id;
  coordA = tokenFor(app, { rol: 'Coordinador', plantelId: plantelA });

  docenteId = (
    await prisma.usuario.create({
      data: { email: uniq('doc') + '@sga.local', nombreCompleto: 'Doc', rol: 'Docente', plantelId: plantelA, hashContrasena: 'x' },
    })
  ).id;
  const grupo = await prisma.grupo.create({ data: { plantelId: plantelA, nombre: uniq('G'), semestre: 1 } });
  cleanup.grupoIds.push(grupo.id);
  const periodo = await prisma.periodo.create({
    data: { plantelId: plantelA, codigo: uniq('P'), fechaInicio: new Date('2025-08-01'), fechaFin: new Date('2026-06-30') },
  });
  cleanup.periodoIds.push(periodo.id);
  const curso = await http.post('/api/cursos').set(auth(coordA)).send({ materiaId, grupoId: grupo.id, docenteId, periodoId: periodo.id }).expect(201);
  cursoId = curso.body.id;
  await prisma.cadete.create({ data: { matricula: CAD, nombreCompleto: CAD, plantelId: plantelA, grupoActualId: grupo.id, estatus: 'Activo' } });
  cleanup.matriculas.push(CAD);
});

afterAll(async () => {
  await prisma.calificacion.deleteMany({ where: { actividad: { parcial: { cursoId } } } });
  await prisma.actividad.deleteMany({ where: { parcial: { cursoId } } });
  await prisma.examen.deleteMany({ where: { parcial: { cursoId } } });
  await prisma.cadete.deleteMany({ where: { matricula: { in: cleanup.matriculas } } });
  await prisma.criterio.deleteMany({ where: { parcial: { cursoId } } });
  await prisma.parcial.deleteMany({ where: { cursoId } });
  await prisma.curso.deleteMany({ where: { id: cursoId } });
  await prisma.grupo.deleteMany({ where: { id: { in: cleanup.grupoIds } } });
  await prisma.periodo.deleteMany({ where: { id: { in: cleanup.periodoIds } } });
  await prisma.usuario.deleteMany({ where: { id: docenteId } });
  await app.close();
});

describe('GET /cursos/:id/parciales/:n/calificaciones (matriz)', () => {
  it('devuelve actividades, cadetes y los valores capturados para prellenar la cuadrícula', async () => {
    const act = await http.post(`/api/cursos/${cursoId}/parciales/1/actividades`).set(auth(coordA)).send({ tipo: 'TI', nombre: 'TI 1' }).expect(201);
    await http
      .post(`/api/cursos/${cursoId}/actividades/${act.body.id}/calificaciones`)
      .set(auth(coordA))
      .send({ registros: [{ cadeteMatricula: CAD, valor: 7.5 }] })
      .expect(200);
    await http.post(`/api/cursos/${cursoId}/parciales/1/examen`).set(auth(coordA)).send({ registros: [{ cadeteMatricula: CAD, valor: 8 }] }).expect(200);

    const res = await http.get(`/api/cursos/${cursoId}/parciales/1/calificaciones`).set(auth(coordA)).expect(200);
    expect(res.body.actividades.map((a: { id: string }) => a.id)).toContain(act.body.id);
    expect(res.body.cadetes.map((c: { matricula: string }) => c.matricula)).toContain(CAD);
    expect(res.body.calificaciones[CAD][act.body.id]).toBe(7.5);
    expect(res.body.examenes[CAD]).toEqual({ valor: 8, estatus: 'PRESENTADO' });
  });
});
