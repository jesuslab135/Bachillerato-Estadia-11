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
let docenteId: string;
const matriculas: string[] = [];

let n = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${n++}`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const CAD_1 = uniq('AOV');

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
  const periodo = await prisma.periodo.create({
    data: { plantelId: plantelA, codigo: uniq('P'), fechaInicio: new Date('2025-08-01'), fechaFin: new Date('2026-06-30') },
  });
  const curso = await http
    .post('/api/cursos')
    .set(auth(coordA))
    .send({ materiaId, grupoId: grupo.id, docenteId, periodoId: periodo.id })
    .expect(201);
  cursoId = curso.body.id;

  await prisma.cadete.create({ data: { matricula: CAD_1, nombreCompleto: CAD_1, plantelId: plantelA, grupoActualId: grupo.id, estatus: 'Activo' } });
  matriculas.push(CAD_1);
});

afterAll(async () => {
  // workflow_event es append-only y fija parcial/curso/grupo/periodo: solo se limpian datos hoja.
  await prisma.examen.deleteMany({ where: { parcial: { cursoId } } });
  await prisma.cadete.deleteMany({ where: { matricula: { in: matriculas } } });
  await app.close();
});

async function cerrarYValidar(numero: number) {
  await http
    .post(`/api/cursos/${cursoId}/parciales/${numero}/examen`)
    .set(auth(coordA))
    .send({ registros: [{ cadeteMatricula: CAD_1, valor: 8 }] })
    .expect(200);
  await http.post(`/api/cursos/${cursoId}/parciales/${numero}/cerrar`).set(auth(coordA)).expect(200);
  await http.post(`/api/cursos/${cursoId}/parciales/${numero}/validar`).set(auth(coordA)).expect(200);
}

describe('FB-B-4 — El acta se genera con cualquier orden de validación', () => {
  it('validar en orden 3→1→2 genera el acta al quedar los 3 Validado', async () => {
    await cerrarYValidar(3);
    await http.get(`/api/cursos/${cursoId}/acta`).set(auth(coordA)).expect(404);
    await cerrarYValidar(1);
    await http.get(`/api/cursos/${cursoId}/acta`).set(auth(coordA)).expect(404);
    await cerrarYValidar(2); // completa el trío → dispara la generación
    const acta = await http.get(`/api/cursos/${cursoId}/acta`).set(auth(coordA)).expect(200);
    expect(acta.body.version).toBe(1);
  });

  it('no se duplica el acta: existe exactamente una versión', async () => {
    const actas = await prisma.acta.findMany({ where: { cursoId } });
    expect(actas).toHaveLength(1);
  });
});
