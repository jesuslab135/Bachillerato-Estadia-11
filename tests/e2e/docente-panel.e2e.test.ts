import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp, tokenFor } from './app';

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;

let coordA: string;
let docToken: string;
let docenteId: string;
let cursoId: string;
const cleanup: { grupoIds: string[]; periodoIds: string[]; matriculas: string[] } = { grupoIds: [], periodoIds: [], matriculas: [] };

let nn = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${nn++}`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const hoyISO = () => new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  const plantelA = (await prisma.plantel.findUniqueOrThrow({ where: { clave: 'BM' } })).id;
  const materiaId = (await prisma.materia.findUniqueOrThrow({ where: { clave: 'MAT-1' } })).id;
  coordA = tokenFor(app, { rol: 'Coordinador', plantelId: plantelA });

  const docente = await prisma.usuario.create({
    data: { email: uniq('doc') + '@sga.local', nombreCompleto: 'Doc', rol: 'Docente', plantelId: plantelA, hashContrasena: 'x' },
  });
  docenteId = docente.id;
  docToken = tokenFor(app, { rol: 'Docente', plantelId: plantelA, sub: docente.id });

  const grupo = await prisma.grupo.create({ data: { plantelId: plantelA, nombre: uniq('G'), semestre: 1 } });
  cleanup.grupoIds.push(grupo.id);
  const periodo = await prisma.periodo.create({
    data: { plantelId: plantelA, codigo: uniq('P'), fechaInicio: new Date('2025-08-01'), fechaFin: new Date('2026-06-30') },
  });
  cleanup.periodoIds.push(periodo.id);

  const curso = await http.post('/api/cursos').set(auth(coordA)).send({ materiaId, grupoId: grupo.id, docenteId, periodoId: periodo.id }).expect(201);
  cursoId = curso.body.id;

  const cad = uniq('CADP');
  cleanup.matriculas.push(cad);
  await prisma.cadete.create({ data: { matricula: cad, nombreCompleto: cad, plantelId: plantelA, grupoActualId: grupo.id, estatus: 'Activo' } });
  await http.post(`/api/cursos/${cursoId}/asistencia`).set(auth(docToken)).send({ fecha: hoyISO(), registros: [{ cadeteMatricula: cad, codigo: 'A' }] }).expect(200);

  // Un cierre próximo: parcial 1 termina en 3 días.
  const en3 = new Date(Date.now() + 3 * 86_400_000);
  await prisma.parcial.update({ where: { cursoId_numero: { cursoId, numero: 1 } }, data: { fechaFin: en3 } });
});

afterAll(async () => {
  await prisma.asistencia.deleteMany({ where: { cursoId } });
  await prisma.cadete.deleteMany({ where: { matricula: { in: cleanup.matriculas } } });
  await prisma.criterio.deleteMany({ where: { parcial: { cursoId } } });
  await prisma.parcial.deleteMany({ where: { cursoId } });
  await prisma.curso.deleteMany({ where: { id: cursoId } });
  await prisma.grupo.deleteMany({ where: { id: { in: cleanup.grupoIds } } });
  await prisma.periodo.deleteMany({ where: { id: { in: cleanup.periodoIds } } });
  await prisma.usuario.deleteMany({ where: { id: docenteId } });
  await app.close();
});

describe('Panel del docente (RF-ASIG-04)', () => {
  it('muestra asistencia de hoy, parciales abiertos y cierres próximos', async () => {
    const res = await http.get('/api/docente/panel').set(auth(docToken)).expect(200);
    const curso = res.body.cursos.find((c: { cursoId: string }) => c.cursoId === cursoId);
    expect(curso).toBeTruthy();
    expect(curso.asistenciaHoy.capturada).toBe(true);
    expect(curso.parcialesAbiertos).toEqual([1, 2, 3]);
    expect(curso.cierresProximos.map((c: { parcial: number }) => c.parcial)).toContain(1);
  });

  it('otro docente sin cursos ve un panel vacío', async () => {
    const otro = tokenFor(app, { rol: 'Docente', plantelId: null, sub: '00000000-0000-0000-0000-000000000999' });
    const res = await http.get('/api/docente/panel').set(auth(otro)).expect(200);
    expect(res.body.cursos).toEqual([]);
  });
});
