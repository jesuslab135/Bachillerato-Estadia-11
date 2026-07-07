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
let docenteId: string;
const parcialIds: Record<number, string> = {};
const matriculas: string[] = [];

let n = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${n++}`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const CAD_APROBADO = uniq('AAP'); // pasa los 3 parciales
const CAD_ORD = uniq('AOR'); // reprueba 1 → Presenta Ordinario
const CAD_EXT = uniq('AEX'); // reprueba 2 → Presenta Extraordinario

// Notas por parcial: promTI (via 1 actividad TI) y examen, para forzar los finales.
// ti10+ex10 → cruda 6 → final 6 (aprueba); solo ex8 → cruda 3.2 → final 3 (reprueba).
const PLAN: Record<number, Record<string, { ti?: number; ex: number }>> = {
  1: { [CAD_APROBADO]: { ti: 10, ex: 10 }, [CAD_ORD]: { ti: 10, ex: 10 }, [CAD_EXT]: { ex: 8 } },
  2: { [CAD_APROBADO]: { ti: 10, ex: 10 }, [CAD_ORD]: { ti: 10, ex: 10 }, [CAD_EXT]: { ex: 8 } },
  3: { [CAD_APROBADO]: { ti: 10, ex: 10 }, [CAD_ORD]: { ex: 8 }, [CAD_EXT]: { ti: 10, ex: 10 } },
};

async function prepararYValidar(numero: number) {
  const plan = PLAN[numero];
  const act = await http
    .post(`/api/cursos/${cursoId}/parciales/${numero}/actividades`)
    .set(auth(coordA))
    .send({ tipo: 'TI', nombre: `TI ${numero}` })
    .expect(201);
  const conTI = Object.entries(plan).filter(([, v]) => typeof v.ti === 'number');
  if (conTI.length > 0) {
    await http
      .post(`/api/cursos/${cursoId}/actividades/${act.body.id}/calificaciones`)
      .set(auth(coordA))
      .send({ registros: conTI.map(([mat, v]) => ({ cadeteMatricula: mat, valor: v.ti })) })
      .expect(200);
  }
  await http
    .post(`/api/cursos/${cursoId}/parciales/${numero}/examen`)
    .set(auth(coordA))
    .send({ registros: Object.entries(plan).map(([mat, v]) => ({ cadeteMatricula: mat, valor: v.ex })) })
    .expect(200);
  await http.post(`/api/cursos/${cursoId}/parciales/${numero}/cerrar`).set(auth(coordA)).expect(200);
  await http.post(`/api/cursos/${cursoId}/parciales/${numero}/validar`).set(auth(coordA)).expect(200);
}

interface FilaActa {
  matricula: string;
  parciales: number[];
  observacion: string;
  calificacionFinal: number;
}
const actaDe = async (token = coordA): Promise<{ version: number; firmadaDocenteEn: string | null; firmadaCoordinacionEn: string | null; hashPdf: string | null; cadetes: FilaActa[] }> =>
  (await http.get(`/api/cursos/${cursoId}/acta`).set(auth(token)).expect(200)).body;
const filaDe = (acta: { cadetes: FilaActa[] }, mat: string): FilaActa => {
  const f = acta.cadetes.find((c) => c.matricula === mat);
  if (!f) throw new Error(`sin fila para ${mat}`);
  return f;
};

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
  const periodo = await prisma.periodo.create({
    data: { plantelId: plantelA, codigo: uniq('P'), fechaInicio: new Date('2025-08-01'), fechaFin: new Date('2026-06-30') },
  });
  const curso = await http.post('/api/cursos').set(auth(coordA)).send({ materiaId, grupoId: grupo.id, docenteId, periodoId: periodo.id }).expect(201);
  cursoId = curso.body.id;
  for (const numero of [1, 2, 3]) {
    parcialIds[numero] = (await prisma.parcial.findUniqueOrThrow({ where: { cursoId_numero: { cursoId, numero } } })).id;
  }
  for (const mat of [CAD_APROBADO, CAD_ORD, CAD_EXT]) {
    await prisma.cadete.create({ data: { matricula: mat, nombreCompleto: mat, plantelId: plantelA, grupoActualId: grupo.id, estatus: 'Activo' } });
    matriculas.push(mat);
  }
});

afterAll(async () => {
  // parcial/curso quedan fijados por WorkflowEvent (append-only); solo limpiamos datos hoja.
  await prisma.examen.deleteMany({ where: { parcial: { cursoId } } });
  await prisma.calificacion.deleteMany({ where: { actividad: { parcial: { cursoId } } } });
  await prisma.cadete.deleteMany({ where: { matricula: { in: matriculas } } });
  await app.close();
});

describe('Generación automática del acta (RF-ACTA-01)', () => {
  it('no existe acta hasta validar los 3 parciales', async () => {
    await prepararYValidar(1);
    await prepararYValidar(2);
    await http.get(`/api/cursos/${cursoId}/acta`).set(auth(coordA)).expect(404);
    await prepararYValidar(3); // valida el 3º con 1 y 2 ya validados → dispara el acta
    const acta = await actaDe();
    expect(acta.version).toBe(1);
  });
});

describe('Cálculo final y observaciones (RN-04, RF-ACTA-02/03/04/05)', () => {
  it('aprobó los 3 ⇒ sin observación, final = ROUND(promedio)', async () => {
    const fila = filaDe(await actaDe(), CAD_APROBADO);
    expect(fila.parciales).toEqual([6, 6, 6]);
    expect(fila.observacion).toBe('');
    expect(fila.calificacionFinal).toBe(6);
  });

  it('reprobó 1 ⇒ "Presenta Ordinario"', async () => {
    const fila = filaDe(await actaDe(), CAD_ORD);
    expect(fila.parciales).toEqual([6, 6, 3]);
    expect(fila.observacion).toBe('Presenta Ordinario');
    expect(fila.calificacionFinal).toBe(5); // ROUND((6+6+3)/3)
  });

  it('reprobó 2 ⇒ "Presenta Extraordinario"', async () => {
    const fila = filaDe(await actaDe(), CAD_EXT);
    expect(fila.parciales).toEqual([3, 3, 6]);
    expect(fila.observacion).toBe('Presenta Extraordinario');
  });
});

describe('Captura de recuperación con elegibilidad (RF-ACTA-03/04)', () => {
  const recuperar = (mat: string, tipo: string, valor: number) =>
    http.post(`/api/cursos/${cursoId}/acta/recuperacion`).set(auth(coordA)).send({ cadeteMatricula: mat, tipo, valor });

  it('rechaza Ordinario a un cadete no elegible (aprobado)', async () => {
    await recuperar(CAD_APROBADO, 'Ordinario', 8).expect(400);
  });

  it('rechaza Extraordinario a quien solo presenta Ordinario', async () => {
    await recuperar(CAD_ORD, 'Extraordinario', 8).expect(400);
  });

  it('Ordinario aprobado recalcula el promedio reemplazando el reprobado (RN-04)', async () => {
    await recuperar(CAD_ORD, 'Ordinario', 8).expect(200);
    const fila = filaDe(await actaDe(), CAD_ORD);
    expect(fila.calificacionFinal).toBe(7); // ROUND((6+6+8)/3)
  });

  it('Extraordinario gobierna con nota directa (RN-04/cascada)', async () => {
    await recuperar(CAD_EXT, 'Extraordinario', 7).expect(200);
    const fila = filaDe(await actaDe(), CAD_EXT);
    expect(fila.calificacionFinal).toBe(7);
  });
});

describe('Doble firma y exportación (RF-ACTA-06/07)', () => {
  it('el acta lleva doble firma con sello de tiempo', async () => {
    await http.post(`/api/cursos/${cursoId}/acta/firmar`).set(auth(docA)).expect(200);
    await http.post(`/api/cursos/${cursoId}/acta/firmar`).set(auth(coordA)).expect(200);
    const acta = await actaDe();
    expect(acta.firmadaDocenteEn).toBeTruthy();
    expect(acta.firmadaCoordinacionEn).toBeTruthy();
  });

  it('exporta con hash de integridad SHA-256', async () => {
    const res = await http.get(`/api/cursos/${cursoId}/acta/export`).set(auth(coordA)).expect(200);
    expect(res.body.hash).toMatch(/^[a-f0-9]{64}$/);
    const acta = await actaDe();
    expect(acta.hashPdf).toBe(res.body.hash);
  });

  it('el export es idempotente: GET no muta y el hash persistido no cambia (FB-B-9)', async () => {
    const antes = await prisma.acta.findFirstOrThrow({ where: { cursoId }, orderBy: { version: 'desc' } });
    const r1 = await http.get(`/api/cursos/${cursoId}/acta/export`).set(auth(coordA)).expect(200);
    const r2 = await http.get(`/api/cursos/${cursoId}/acta/export`).set(auth(coordA)).expect(200);
    expect(r1.body.hash).toBe(antes.hashPdf);
    expect(r2.body.hash).toBe(antes.hashPdf);
    const despues = await prisma.acta.findFirstOrThrow({ where: { id: antes.id } });
    expect(despues.hashPdf).toBe(antes.hashPdf);
  });

  it('las firmas dejan rastro en bitácora (FB-B-9)', async () => {
    const acta = await prisma.acta.findFirstOrThrow({ where: { cursoId }, orderBy: { version: 'desc' } });
    const eventos = await prisma.auditLog.findMany({ where: { tipoEvento: 'ACTA_FIRMA', entidadId: acta.id } });
    expect(eventos.length).toBeGreaterThanOrEqual(2); // docente + coordinación
  });

  it('la captura de recuperación deja rastro en bitácora (FB-B-9)', async () => {
    const p3 = await prisma.parcial.findUniqueOrThrow({ where: { cursoId_numero: { cursoId, numero: 3 } } });
    const examen = await prisma.examen.findUniqueOrThrow({
      where: { cadeteMatricula_parcialId_tipo: { cadeteMatricula: CAD_ORD, parcialId: p3.id, tipo: 'Ordinario' } },
    });
    const eventos = await prisma.auditLog.findMany({ where: { tipoEvento: 'RECUPERACION_CAPTURA', entidadId: examen.id } });
    expect(eventos.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Reapertura genera nueva versión (RN-06/RF-WF-04)', () => {
  it('reabrir el 3er parcial y revalidar produce el acta v2', async () => {
    await http
      .post(`/api/cursos/${cursoId}/parciales/3/reabrir`)
      .set(auth(coordA))
      .send({ motivo: 'Corrección de calificaciones solicitada por coordinación académica' })
      .expect(200);
    await http.post(`/api/cursos/${cursoId}/parciales/3/cerrar`).set(auth(coordA)).expect(200);
    await http.post(`/api/cursos/${cursoId}/parciales/3/validar`).set(auth(coordA)).expect(200);
    const acta = await actaDe();
    expect(acta.version).toBe(2);
  });
});

describe('Scope por plantel (RF-AUTH-03)', () => {
  it('un Coordinador de otro plantel no ve el acta (403)', async () => {
    await http.get(`/api/cursos/${cursoId}/acta`).set(auth(coordB)).expect(403);
  });
});
