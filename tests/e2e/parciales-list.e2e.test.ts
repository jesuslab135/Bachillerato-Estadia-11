import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp, tokenFor } from './app';

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;

let coordA: string;
let coordB: string;
let cursoId: string;
let docenteId: string;
const cleanup: { grupoIds: string[]; periodoIds: string[] } = { grupoIds: [], periodoIds: [] };

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
  coordB = tokenFor(app, { rol: 'Coordinador', plantelId: plantelB });

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
});

afterAll(async () => {
  await prisma.criterio.deleteMany({ where: { parcial: { cursoId } } });
  await prisma.parcial.deleteMany({ where: { cursoId } });
  await prisma.curso.deleteMany({ where: { id: cursoId } });
  await prisma.grupo.deleteMany({ where: { id: { in: cleanup.grupoIds } } });
  await prisma.periodo.deleteMany({ where: { id: { in: cleanup.periodoIds } } });
  await prisma.usuario.deleteMany({ where: { id: docenteId } });
  await app.close();
});

describe('GET /cursos/:id/parciales', () => {
  it('lista los 3 parciales con estado y pesos', async () => {
    const res = await http.get(`/api/cursos/${cursoId}/parciales`).set(auth(coordA)).expect(200);
    expect(res.body).toHaveLength(3);
    expect(res.body.map((p: { numero: number }) => p.numero)).toEqual([1, 2, 3]);
    const p1 = res.body[0];
    expect(p1.estado).toBe('Borrador');
    expect(p1.pesoTI + p1.pesoTE + p1.pesoTA + p1.pesoEX).toBeCloseTo(1);
  });

  it('un Coordinador de otro plantel no puede listarlos (403)', async () => {
    await http.get(`/api/cursos/${cursoId}/parciales`).set(auth(coordB)).expect(403);
  });
});
