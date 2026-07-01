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
let docA: string;
let cursoId: string;
let grupoId: string;
let docenteId: string;
const parcialIds: Record<number, string> = {};
const periodoIds: string[] = [];
const grupoIds: string[] = [];
const matriculas: string[] = [];

let n = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${n++}`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const CAD_OK = uniq('WOK');
const CAD_SDE = uniq('WSDE'); // 3 faltas en parcial 1 → SDE
const CAD_NOEX = uniq('WNOX'); // activo, sin examen, sin SDE → bloquea cerrar

let dia: (base: Date, offset: number) => string;

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
  docA = tokenFor(app, { rol: 'Docente', plantelId: plantelA, sub: docente.id });

  const grupo = await prisma.grupo.create({ data: { plantelId: plantelA, nombre: uniq('G'), semestre: 1 } });
  grupoId = grupo.id;
  grupoIds.push(grupo.id);
  const periodo = await prisma.periodo.create({
    data: { plantelId: plantelA, codigo: uniq('P'), fechaInicio: new Date('2025-08-01'), fechaFin: new Date('2026-06-30') },
  });
  periodoIds.push(periodo.id);

  const curso = await http.post('/api/cursos').set(auth(coordA)).send({ materiaId, grupoId, docenteId, periodoId: periodo.id }).expect(201);
  cursoId = curso.body.id;

  for (const numero of [1, 2, 3]) {
    parcialIds[numero] = (await prisma.parcial.findUniqueOrThrow({ where: { cursoId_numero: { cursoId, numero } } })).id;
  }
  const p1 = await prisma.parcial.findUniqueOrThrow({ where: { id: parcialIds[1] } });
  const b1 = new Date(p1.fechaInicio!).getTime();
  dia = (_base, offset) => new Date(b1 + offset * 86_400_000).toISOString().slice(0, 10);

  for (const mat of [CAD_OK, CAD_SDE, CAD_NOEX]) {
    await prisma.cadete.create({ data: { matricula: mat, nombreCompleto: mat, plantelId: plantelA, grupoActualId: grupoId, estatus: 'Activo' } });
    matriculas.push(mat);
  }

  // CAD_SDE acumula 3 faltas en la ventana del parcial 1 → SDE (no requiere examen para cerrar).
  for (const off of [0, 1, 2]) {
    await http
      .post(`/api/cursos/${cursoId}/asistencia`)
      .set(auth(coordA))
      .send({ fecha: dia(p1.fechaInicio!, off), registros: [{ cadeteMatricula: CAD_SDE, codigo: 'F' }] })
      .expect(200);
  }
});

afterAll(async () => {
  // workflow_event es append-only y su FK (RESTRICT) fija al parcial/curso/grupo/periodo:
  // esas filas no se pueden borrar por diseño. Solo limpiamos los datos hoja borrables.
  await prisma.examen.deleteMany({ where: { parcial: { cursoId } } });
  await prisma.asistencia.deleteMany({ where: { cursoId } });
  await prisma.cadete.deleteMany({ where: { matricula: { in: matriculas } } });
  await app.close();
});

const examen = (token: string, numero: number, mats: string[]) =>
  http
    .post(`/api/cursos/${cursoId}/parciales/${numero}/examen`)
    .set(auth(token))
    .send({ registros: mats.map((m) => ({ cadeteMatricula: m, valor: 8 })) });
const cerrar = (token: string, numero: number) => http.post(`/api/cursos/${cursoId}/parciales/${numero}/cerrar`).set(auth(token));
const estado = async (numero: number) => (await prisma.parcial.findUniqueOrThrow({ where: { id: parcialIds[numero] } })).estado;

describe('Condiciones de cierre (RF-WF-02)', () => {
  it('bloquea cerrar si un cadete activo no tiene examen ni SDE', async () => {
    await examen(coordA, 1, [CAD_OK]).expect(200); // CAD_SDE es SDE; CAD_NOEX queda sin examen
    await cerrar(coordA, 1).expect(400);
    expect(await estado(1)).toBe('Borrador');
  });

  it('bloquea cerrar si %EX está fuera de [0.20,0.70] (RN-02)', async () => {
    // Se fuerza por DB (en Borrador el CHECK no aplica); el cierre debe rechazarlo en servidor.
    await prisma.parcial.update({
      where: { id: parcialIds[3] },
      data: { pesoTI: 0.27, pesoTE: 0.27, pesoTA: 0.27, pesoEX: 0.19 },
    });
    await cerrar(coordA, 3).expect(400);
    expect(await estado(3)).toBe('Borrador');
  });

  it('cierra cuando todos los activos tienen examen o SDE (RF-WF-01)', async () => {
    await examen(coordA, 1, [CAD_NOEX]).expect(200);
    await cerrar(docA, 1).expect(200);
    expect(await estado(1)).toBe('CerradoDocente');
  });
});

describe('Validación e inmutabilidad (RF-WF-03/04, RN-06)', () => {
  it('un Docente no puede validar (403)', async () => {
    await http.post(`/api/cursos/${cursoId}/parciales/1/validar`).set(auth(docA)).expect(403);
  });

  it('Coordinación valida → Validado', async () => {
    await http.post(`/api/cursos/${cursoId}/parciales/1/validar`).set(auth(coordA)).expect(200);
    expect(await estado(1)).toBe('Validado');
  });

  it('un parcial Validado es inmutable: editar pesos → 400', async () => {
    await http
      .patch(`/api/cursos/${cursoId}/parciales/1/pesos`)
      .set(auth(coordA))
      .send({ ti: 0.2, te: 0.2, ta: 0.2, ex: 0.4, criterios: [] })
      .expect(400);
  });

  it('reabrir exige motivo ≥ 30 caracteres (RN-06)', async () => {
    await http.post(`/api/cursos/${cursoId}/parciales/1/reabrir`).set(auth(coordA)).send({ motivo: 'corto' }).expect(400);
  });

  it('reabrir con motivo válido → Reabierto y vuelve a ser editable', async () => {
    await http
      .post(`/api/cursos/${cursoId}/parciales/1/reabrir`)
      .set(auth(coordA))
      .send({ motivo: 'Error de captura detectado por coordinación en el examen' })
      .expect(200);
    expect(await estado(1)).toBe('Reabierto');
    await http
      .patch(`/api/cursos/${cursoId}/parciales/1/pesos`)
      .set(auth(coordA))
      .send({
        ti: 0.2,
        te: 0.2,
        ta: 0.2,
        ex: 0.4,
        criterios: (['TI', 'TE', 'TA'] as const).flatMap((tipo) => Array.from({ length: 5 }, (_, i) => ({ tipo, orden: i + 1, peso: 0.04 }))),
      })
      .expect(200);
  });
});

describe('Devolver a Borrador (RF-WF-03)', () => {
  it('Coordinación devuelve un parcial cerrado con comentario', async () => {
    await examen(coordA, 2, [CAD_OK, CAD_SDE, CAD_NOEX]).expect(200); // en parcial 2 nadie es SDE
    await cerrar(coordA, 2).expect(200);
    expect(await estado(2)).toBe('CerradoDocente');
    await http.post(`/api/cursos/${cursoId}/parciales/2/devolver`).set(auth(coordA)).send({ comentario: 'Revisar TE' }).expect(200);
    expect(await estado(2)).toBe('Borrador');
  });
});

describe('Periodo de cierre (RF-WF-02)', () => {
  it('bloquea cerrar antes de la fecha de apertura de cierre', async () => {
    await prisma.parcial.update({
      where: { id: parcialIds[3] },
      data: { pesoTI: 0.2, pesoTE: 0.2, pesoTA: 0.2, pesoEX: 0.4, fechaAperturaCierre: new Date('2027-01-01') },
    });
    await examen(coordA, 3, [CAD_OK, CAD_SDE, CAD_NOEX]).expect(200); // en parcial 3 nadie es SDE
    await cerrar(coordA, 3).expect(400);
    expect(await estado(3)).toBe('Borrador');
  });

  it('permite cerrar una vez iniciado el periodo de cierre', async () => {
    await prisma.parcial.update({ where: { id: parcialIds[3] }, data: { fechaAperturaCierre: new Date('2025-01-01') } });
    await cerrar(coordA, 3).expect(200);
    expect(await estado(3)).toBe('CerradoDocente');
  });
});

describe('Bitácora y scope (RF-WF-05, RF-AUTH-03)', () => {
  it('un Coordinador de otro plantel no puede cerrar (403)', async () => {
    await cerrar(coordB, 2).expect(403);
  });

  it('registra los eventos de workflow del parcial', async () => {
    const res = await http.get(`/api/cursos/${cursoId}/parciales/1/eventos`).set(auth(coordA)).expect(200);
    const acciones = res.body.map((e: { accion: string }) => e.accion);
    expect(acciones).toEqual(expect.arrayContaining(['cerrar', 'validar', 'reabrir']));
  });

  it('la bitácora filtra por entidad y rechaza a un Docente (403)', async () => {
    await http.get('/api/bitacora?entidad=Parcial').set(auth(docA)).expect(403);
    const res = await http.get('/api/bitacora?entidad=Parcial').set(auth(coordA)).expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('exporta la bitácora filtrada como CSV (RF-WF-05)', async () => {
    const res = await http.get('/api/bitacora/export?entidad=Parcial').set(auth(coordA)).expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text.split('\n')[0]).toContain('tipoEvento');
    expect(res.text).toContain('PARCIAL_');
  });
});
