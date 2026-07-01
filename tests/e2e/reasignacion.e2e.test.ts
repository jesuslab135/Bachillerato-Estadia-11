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
let docente1: string;
let docente2: string;
let docenteOtroPlantel: string;
const cleanup: { grupoIds: string[]; periodoIds: string[]; usuarioIds: string[] } = { grupoIds: [], periodoIds: [], usuarioIds: [] };

let nn = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${nn++}`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  const plantelA = (await prisma.plantel.findUniqueOrThrow({ where: { clave: 'BM' } })).id;
  const plantelB = (await prisma.plantel.findUniqueOrThrow({ where: { clave: 'BC' } })).id;
  const materiaId = (await prisma.materia.findUniqueOrThrow({ where: { clave: 'MAT-1' } })).id;
  coordA = tokenFor(app, { rol: 'Coordinador', plantelId: plantelA });

  const mkDoc = async (plantelId: string) => {
    const d = await prisma.usuario.create({
      data: { email: uniq('doc') + '@sga.local', nombreCompleto: 'Doc', rol: 'Docente', plantelId, hashContrasena: 'x' },
    });
    cleanup.usuarioIds.push(d.id);
    return d.id;
  };
  docente1 = await mkDoc(plantelA);
  docente2 = await mkDoc(plantelA);
  docenteOtroPlantel = await mkDoc(plantelB);

  const grupo = await prisma.grupo.create({ data: { plantelId: plantelA, nombre: uniq('G'), semestre: 1 } });
  cleanup.grupoIds.push(grupo.id);
  const periodo = await prisma.periodo.create({
    data: { plantelId: plantelA, codigo: uniq('P'), fechaInicio: new Date('2025-08-01'), fechaFin: new Date('2026-06-30') },
  });
  cleanup.periodoIds.push(periodo.id);
  const curso = await http.post('/api/cursos').set(auth(coordA)).send({ materiaId, grupoId: grupo.id, docenteId: docente1, periodoId: periodo.id }).expect(201);
  cursoId = curso.body.id;
});

afterAll(async () => {
  await prisma.criterio.deleteMany({ where: { parcial: { cursoId } } });
  await prisma.parcial.deleteMany({ where: { cursoId } });
  await prisma.curso.deleteMany({ where: { id: cursoId } });
  await prisma.grupo.deleteMany({ where: { id: { in: cleanup.grupoIds } } });
  await prisma.periodo.deleteMany({ where: { id: { in: cleanup.periodoIds } } });
  await prisma.usuario.deleteMany({ where: { id: { in: cleanup.usuarioIds } } });
  await app.close();
});

describe('Reasignación de docente (RF-ASIG-02)', () => {
  it('exige motivo (400)', async () => {
    await http.patch(`/api/cursos/${cursoId}/docente`).set(auth(coordA)).send({ docenteId: docente2 }).expect(400);
  });

  it('rechaza un docente de otro plantel (400)', async () => {
    await http
      .patch(`/api/cursos/${cursoId}/docente`)
      .set(auth(coordA))
      .send({ docenteId: docenteOtroPlantel, motivo: 'Prueba' })
      .expect(400);
  });

  it('reasigna con motivo, registra en bitácora y preserva el curso', async () => {
    await http.patch(`/api/cursos/${cursoId}/docente`).set(auth(coordA)).send({ docenteId: docente2, motivo: 'Baja médica del titular' }).expect(200);
    const curso = await prisma.curso.findUniqueOrThrow({ where: { id: cursoId } });
    expect(curso.docenteId).toBe(docente2);
    const audit = await prisma.auditLog.findFirst({
      where: { entidad: 'Curso', entidadId: cursoId, tipoEvento: 'REASIGNAR_DOCENTE' },
      orderBy: { timestamp: 'desc' },
    });
    expect(audit).toBeTruthy();
    expect((audit!.valorNuevoJson as { motivo: string }).motivo).toBe('Baja médica del titular');
  });
});
