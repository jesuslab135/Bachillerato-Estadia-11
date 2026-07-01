import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TipoCategoria } from '@prisma/client';
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
let parcial1Id: string;
let docenteId: string;
const periodoIds: string[] = [];
const grupoIds: string[] = [];
const matriculas: string[] = [];

let n = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${n++}`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const CAD_CALC = uniq('CADC'); // notas que producen cruda = 5.4
const CAD_SDE = uniq('CADS'); // acumula 3 faltas → SDE
const CAD_AVG = uniq('CADV'); // promedio ignora 0
const CAD_OTRO = uniq('CADX'); // otro grupo
const CAD_BAJA = uniq('CADBD'); // baja definitiva

let dia: (offset: number) => string;

const TIPOS: TipoCategoria[] = ['TI', 'TE', 'TA'];

/** 15 criterios (5 por tipo) cada uno = pesoMacro/5, para PATCH de pesos. */
const criterios15 = (pesos: { ti: number; te: number; ta: number }) =>
  TIPOS.flatMap((tipo) =>
    Array.from({ length: 5 }, (_, i) => ({ tipo, orden: i + 1, peso: pesos[tipo.toLowerCase() as 'ti' | 'te' | 'ta'] / 5 })),
  );

const patchPesos = (token: string, body: object) =>
  http.patch(`/api/cursos/${cursoId}/parciales/1/pesos`).set(auth(token)).send(body);

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  plantelA = (await prisma.plantel.findUniqueOrThrow({ where: { clave: 'BM' } })).id;
  plantelB = (await prisma.plantel.findUniqueOrThrow({ where: { clave: 'BC' } })).id;
  const materiaId = (await prisma.materia.findUniqueOrThrow({ where: { clave: 'MAT-1' } })).id;
  coordA = tokenFor(app, { rol: 'Coordinador', plantelId: plantelA });
  coordB = tokenFor(app, { rol: 'Coordinador', plantelId: plantelB });

  docenteId = (
    await prisma.usuario.create({
      data: { email: uniq('doc') + '@sga.local', nombreCompleto: 'Doc', rol: 'Docente', plantelId: plantelA, hashContrasena: 'x' },
    })
  ).id;
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
  parcial1Id = p1.id;
  const base = new Date(p1.fechaInicio!).getTime();
  dia = (offset) => new Date(base + offset * 86_400_000).toISOString().slice(0, 10);

  for (const [mat, grp, estatus] of [
    [CAD_CALC, grupoId, 'Activo'],
    [CAD_SDE, grupoId, 'Activo'],
    [CAD_AVG, grupoId, 'Activo'],
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
  await prisma.calificacion.deleteMany({ where: { actividad: { parcial: { cursoId } } } });
  await prisma.actividad.deleteMany({ where: { parcial: { cursoId } } });
  await prisma.examen.deleteMany({ where: { parcial: { cursoId } } });
  await prisma.puntoExtra.deleteMany({ where: { parcial: { cursoId } } });
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

describe('Ponderación del parcial (§6)', () => {
  it('rechaza suma de pesos ≠ 1.0 (RF-POND-01)', async () => {
    await patchPesos(coordA, { ti: 0.3, te: 0.3, ta: 0.3, ex: 0.3, criterios: criterios15({ ti: 0.3, te: 0.3, ta: 0.3 }) }).expect(400);
  });

  it.each([
    [0.19, 0.27, 0.27, 0.27, 400],
    [0.2, 0.3, 0.3, 0.2, 200],
    [0.7, 0.1, 0.1, 0.1, 200],
    [0.71, 0.1, 0.1, 0.09, 400],
  ])('%%EX=%s → %s (RF-POND-02/RN-02)', async (ex, ti, te, ta, status) => {
    await patchPesos(coordA, { ti, te, ta, ex, criterios: criterios15({ ti, te, ta }) }).expect(status);
  });

  it('rechaza criterios que no suman el peso macro (RF-POND-03)', async () => {
    const criterios = criterios15({ ti: 0.2, te: 0.2, ta: 0.2 });
    criterios[0].peso = 0; // TI ya no suma 0.2
    await patchPesos(coordA, { ti: 0.2, te: 0.2, ta: 0.2, ex: 0.4, criterios }).expect(400);
  });

  it('un Coordinador de otro plantel no puede editar pesos (403)', async () => {
    await patchPesos(coordB, { ti: 0.2, te: 0.2, ta: 0.2, ex: 0.4, criterios: criterios15({ ti: 0.2, te: 0.2, ta: 0.2 }) }).expect(403);
  });

  it('guarda pesos válidos y restaura los por defecto (200)', async () => {
    await patchPesos(coordA, { ti: 0.2, te: 0.2, ta: 0.2, ex: 0.4, criterios: criterios15({ ti: 0.2, te: 0.2, ta: 0.2 }) }).expect(200);
  });
});

describe('Actividades y calificaciones (§5)', () => {
  it('impide crear la actividad 31 de una categoría (RF-CAL-01)', async () => {
    await prisma.actividad.createMany({
      data: Array.from({ length: 30 }, (_, i) => ({ parcialId: parcial1Id, tipo: 'TE' as TipoCategoria, orden: i + 1, nombre: `TE ${i + 1}` })),
    });
    await http
      .post(`/api/cursos/${cursoId}/parciales/1/actividades`)
      .set(auth(coordA))
      .send({ tipo: 'TE', nombre: 'TE 31' })
      .expect(400);
  });

  it('crea actividad y rechaza calificación fuera de [0,10] (RF-CAL-03)', async () => {
    const act = await http
      .post(`/api/cursos/${cursoId}/parciales/1/actividades`)
      .set(auth(coordA))
      .send({ tipo: 'TI', nombre: 'TI 1' })
      .expect(201);
    const actId = act.body.id;
    await http
      .post(`/api/cursos/${cursoId}/actividades/${actId}/calificaciones`)
      .set(auth(coordA))
      .send({ registros: [{ cadeteMatricula: CAD_CALC, valor: 11 }] })
      .expect(400);
    await http
      .post(`/api/cursos/${cursoId}/actividades/${actId}/calificaciones`)
      .set(auth(coordA))
      .send({ registros: [{ cadeteMatricula: CAD_CALC, valor: -1 }] })
      .expect(400);
  });

  it('rechaza calificar un cadete en baja definitiva (RN-05)', async () => {
    const act = await http
      .post(`/api/cursos/${cursoId}/parciales/1/actividades`)
      .set(auth(coordA))
      .send({ tipo: 'TI', nombre: 'TI baja' })
      .expect(201);
    await http
      .post(`/api/cursos/${cursoId}/actividades/${act.body.id}/calificaciones`)
      .set(auth(coordA))
      .send({ registros: [{ cadeteMatricula: CAD_BAJA, valor: 8 }] })
      .expect(400);
  });

  it('el promedio de categoría ignora el 0 (RF-CAL-04)', async () => {
    const mk = (nombre: string) =>
      http.post(`/api/cursos/${cursoId}/parciales/1/actividades`).set(auth(coordA)).send({ tipo: 'TA', nombre }).expect(201);
    const a1 = (await mk('TA avg 1')).body.id;
    const a2 = (await mk('TA avg 2')).body.id;
    const cal = (actId: string, valor: number) =>
      http
        .post(`/api/cursos/${cursoId}/actividades/${actId}/calificaciones`)
        .set(auth(coordA))
        .send({ registros: [{ cadeteMatricula: CAD_AVG, valor }] })
        .expect(200);
    await cal(a1, 8);
    await cal(a2, 0);
    const res = await http.get(`/api/cursos/${cursoId}/parciales/1/calculo`).set(auth(coordA)).expect(200);
    const fila = res.body.cadetes.find((c: { matricula: string }) => c.matricula === CAD_AVG);
    expect(fila.promTA).toBeCloseTo(8);
  });
});

describe('Examen (§5)', () => {
  it('acepta valor numérico y código NP (RF-CAL-06)', async () => {
    await http
      .post(`/api/cursos/${cursoId}/parciales/1/examen`)
      .set(auth(coordA))
      .send({ registros: [{ cadeteMatricula: CAD_CALC, valor: 9.5 }, { cadeteMatricula: CAD_AVG, np: true }] })
      .expect(200);
    const np = await prisma.examen.findFirstOrThrow({ where: { parcialId: parcial1Id, cadeteMatricula: CAD_AVG } });
    expect(np.estatus).toBe('NP');
    expect(np.valor).toBeNull();
  });

  it('bloquea capturar examen a un cadete SDE (RF-CAL-07/RN-01)', async () => {
    for (const off of [0, 1, 2]) {
      await http
        .post(`/api/cursos/${cursoId}/asistencia`)
        .set(auth(coordA))
        .send({ fecha: dia(off), registros: [{ cadeteMatricula: CAD_SDE, codigo: 'F' }] })
        .expect(200);
    }
    await http
      .post(`/api/cursos/${cursoId}/parciales/1/examen`)
      .set(auth(coordA))
      .send({ registros: [{ cadeteMatricula: CAD_SDE, valor: 8 }] })
      .expect(400);
  });
});

describe('Cálculo del parcial (§6)', () => {
  it('cruda en [5,6) aplica piso de 5 → final 5 (RF-POND-04/RN-03)', async () => {
    // Pesos por defecto (TI/TE/TA/EX = 0.2/0.2/0.2/0.4). Damos a CAD_CALC promTI=8
    // (una actividad TI con 8) → EC=1.6; examen 9.5*0.4=3.8 → cruda 5.4 ∈ [5,6) → piso 5.
    const act = await http
      .post(`/api/cursos/${cursoId}/parciales/1/actividades`)
      .set(auth(coordA))
      .send({ tipo: 'TI', nombre: 'TI calc' })
      .expect(201);
    await http
      .post(`/api/cursos/${cursoId}/actividades/${act.body.id}/calificaciones`)
      .set(auth(coordA))
      .send({ registros: [{ cadeteMatricula: CAD_CALC, valor: 8 }] })
      .expect(200);

    const res = await http.get(`/api/cursos/${cursoId}/parciales/1/calculo`).set(auth(coordA)).expect(200);
    const fila = res.body.cadetes.find((c: { matricula: string }) => c.matricula === CAD_CALC);
    expect(fila.califCruda).toBeCloseTo(5.4);
    expect(fila.califFinal).toBe(5); // piso5(5.4)=5 → round → 5
    expect(fila.sde).toBe(false);
  });

  it('un cadete SDE no suma examen: cruda = EC (RF-CAL-07/RN-01)', async () => {
    const res = await http.get(`/api/cursos/${cursoId}/parciales/1/calculo`).set(auth(coordA)).expect(200);
    const fila = res.body.cadetes.find((c: { matricula: string }) => c.matricula === CAD_SDE);
    expect(fila.sde).toBe(true);
    expect(fila.evaluacionContinua).toBeCloseTo(fila.califCruda);
  });

  it('con punto extra activo, final = piso→ROUND(cruda) + 1 (RF-POND-05)', async () => {
    await http
      .patch(`/api/cursos/${cursoId}/parciales/1/punto-extra`)
      .set(auth(coordA))
      .send({ registros: [{ cadeteMatricula: CAD_CALC, aplica: true }] })
      .expect(200);
    const res = await http.get(`/api/cursos/${cursoId}/parciales/1/calculo`).set(auth(coordA)).expect(200);
    const fila = res.body.cadetes.find((c: { matricula: string }) => c.matricula === CAD_CALC);
    expect(fila.puntoExtra).toBe(true);
    expect(fila.califFinal).toBe(6); // piso5(5.4)=5 → round 5 → +1 = 6
  });
});
