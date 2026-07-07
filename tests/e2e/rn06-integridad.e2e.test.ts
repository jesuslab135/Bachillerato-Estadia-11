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
let docenteId: string;
const matriculas: string[] = [];

let n = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${n++}`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const CAD_1 = uniq('RN6A');
const CAD_2 = uniq('RN6B');

let diaP1: (offset: number) => string;
let fueraDeVentanas: string;

const capturar = (fecha: string, registros: { cadeteMatricula: string; codigo: string }[]) =>
  http.post(`/api/cursos/${cursoId}/asistencia`).set(auth(coordA)).send({ fecha, registros });
const examen = (numero: number, mats: string[]) =>
  http
    .post(`/api/cursos/${cursoId}/parciales/${numero}/examen`)
    .set(auth(coordA))
    .send({ registros: mats.map((m) => ({ cadeteMatricula: m, valor: 8 })) });
const cerrar = (numero: number) => http.post(`/api/cursos/${cursoId}/parciales/${numero}/cerrar`).set(auth(coordA));
const validar = (numero: number) => http.post(`/api/cursos/${cursoId}/parciales/${numero}/validar`).set(auth(coordA));

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

  const curso = await http
    .post('/api/cursos')
    .set(auth(coordA))
    .send({ materiaId, grupoId, docenteId, periodoId: periodo.id })
    .expect(201);
  cursoId = curso.body.id;

  const p1 = await prisma.parcial.findUniqueOrThrow({ where: { cursoId_numero: { cursoId, numero: 1 } } });
  const base = new Date(p1.fechaInicio!).getTime();
  diaP1 = (offset) => new Date(base + offset * 86_400_000).toISOString().slice(0, 10);
  fueraDeVentanas = '2025-07-01'; // antes del inicio del periodo: no cae en ninguna ventana de parcial

  for (const mat of [CAD_1, CAD_2]) {
    await prisma.cadete.create({ data: { matricula: mat, nombreCompleto: mat, plantelId: plantelA, grupoActualId: grupoId, estatus: 'Activo' } });
    matriculas.push(mat);
  }

  // CAD_1 con una falta F dentro de la ventana del parcial 1 (para el intento F→J posterior).
  await capturar(diaP1(0), [{ cadeteMatricula: CAD_1, codigo: 'F' }]).expect(200);

  // Parcial 1 queda Validado (RN-06: inmutable).
  await examen(1, [CAD_1, CAD_2]).expect(200);
  await cerrar(1).expect(200);
  await validar(1).expect(200);
});

afterAll(async () => {
  // workflow_event es append-only y fija parcial/curso/grupo/periodo: solo se limpian datos hoja.
  await prisma.examen.deleteMany({ where: { parcial: { cursoId } } });
  await prisma.asistencia.deleteMany({ where: { cursoId } });
  await prisma.cadete.deleteMany({ where: { matricula: { in: matriculas } } });
  await app.close();
});

describe('RN-06 integral: asistencia en ventana de parcial bloqueado (FB-B-3)', () => {
  it('rechaza capturar asistencia en fecha dentro de un parcial Validado (409)', async () => {
    await capturar(diaP1(1), [{ cadeteMatricula: CAD_2, codigo: 'A' }]).expect(409);
  });

  it('rechaza el cambio F→J dentro de un parcial Validado (409) y preserva la F', async () => {
    await capturar(diaP1(0), [{ cadeteMatricula: CAD_1, codigo: 'J' }]).expect(409);
    const fila = await prisma.asistencia.findUniqueOrThrow({
      where: { cadeteMatricula_cursoId_fecha: { cadeteMatricula: CAD_1, cursoId, fecha: new Date(diaP1(0)) } },
    });
    expect(fila.codigo).toBe('F');
  });

  it('permite capturar asistencia en fechas fuera de toda ventana de parcial (comportamiento actual)', async () => {
    await capturar(fueraDeVentanas, [{ cadeteMatricula: CAD_2, codigo: 'A' }]).expect(200);
  });
});

describe('Transiciones sin carreras (compare-and-swap, FB-B-3)', () => {
  it('el segundo cierre del mismo parcial responde 409', async () => {
    await examen(2, [CAD_1, CAD_2]).expect(200);
    await cerrar(2).expect(200);
    await cerrar(2).expect(409);
  });

  it('validar dos veces el mismo parcial responde 409', async () => {
    await validar(2).expect(200);
    await validar(2).expect(409);
  });
});
