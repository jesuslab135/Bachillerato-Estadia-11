/**
 * Seed de DEMO — limpia la DB y la puebla con datos ricos y realistas para ver TODAS las
 * pantallas y los tres roles (Operador, Coordinación, Docente) con contenido.
 *
 * Uso (desde backend/):  npm run seed:demo
 *
 * Destructivo (TRUNCATE ... CASCADE, igual que seed:test). SOLO para desarrollo/demo local.
 * No sustituye a seed.ts ni a seed-test.ts (las pruebas dependen de seed-test).
 *
 * Cubre: 2 planteles, usuarios de cada rol (varios docentes), grupos por semestre, periodo
 * activo + uno inactivo, 30 cadetes por grupo (con bajas), cursos en todos los estados de
 * parcial (Borrador/CerradoDocente/Validado/Reabierto), asistencia con casos SDE, calificaciones
 * y exámenes (con NP), actas en tres variantes (sin firmar / firmada docente / doble firma + hash
 * + recuperaciones), y bitácora (audit_log + workflow_event) poblada.
 */
import { PrismaClient, TipoCategoria, EstadoParcial, CodigoAsistencia } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { MATERIAS } from '../prisma/catalogo-materias';

const prisma = new PrismaClient();

const PASSWORD = process.env.SEED_PASSWORD ?? 'SgaTemporal2026!';
const BCRYPT_COST = 12;
const DAY = 86_400_000;
const PESOS = { ti: 0.2, te: 0.2, ta: 0.2, ex: 0.4 };
const TIPOS: TipoCategoria[] = ['TI', 'TE', 'TA'];
const CADETES_POR_GRUPO = 30;

const NOMBRES = [
  'Santiago', 'Valeria', 'Mateo', 'Ximena', 'Diego', 'Regina', 'Emiliano', 'Renata', 'Sebastián', 'Camila',
  'Leonardo', 'María José', 'Ángel', 'Fernanda', 'Iker', 'Danna', 'Adrián', 'Naomi', 'Gael', 'Andrea',
  'Maximiliano', 'Paola', 'Rodrigo', 'Ana Sofía', 'Alexander', 'Isabella', 'Bruno', 'Jimena', 'Julián', 'Frida',
];
const AP_PATERNO = [
  'Hernández', 'García', 'Martínez', 'López', 'González', 'Pérez', 'Rodríguez', 'Sánchez', 'Ramírez', 'Cruz',
  'Flores', 'Gómez', 'Morales', 'Vázquez', 'Reyes', 'Jiménez', 'Torres', 'Díaz', 'Mendoza', 'Aguilar',
  'Ortiz', 'Castillo', 'Romero', 'Álvarez', 'Ruiz', 'Domínguez', 'Guerrero', 'Rojas', 'Navarro', 'Campos',
];
const AP_MATERNO = [
  'Salazar', 'Ríos', 'Cabrera', 'Ibarra', 'Fuentes', 'Cortés', 'Núñez', 'Vega', 'Rincón', 'Ávila',
  'Bautista', 'Cervantes', 'Delgado', 'Escobar', 'Franco', 'Gallardo', 'Herrera', 'Lara', 'Macías', 'Ochoa',
  'Padilla', 'Quintero', 'Robledo', 'Solís', 'Tapia', 'Urbina', 'Valencia', 'Zamora', 'Bravo', 'Meza',
];

const pad3 = (n: number) => String(n).padStart(3, '0');
const nombreCadete = (i: number) =>
  `${AP_PATERNO[i % AP_PATERNO.length]} ${AP_MATERNO[(i * 7) % AP_MATERNO.length]}, ${NOMBRES[(i * 3) % NOMBRES.length]}`;

// Calificaciones: nivel de aprobación por índice (variación para que los resultados no sean idénticos).
const ALTO = (i: number) => 7.5 + (i % 4) * 0.5; // 7.5 .. 9.0 → aprueba
const BAJO = (i: number) => 3 + (i % 2) * 0.5; //   3.0 .. 3.5 → reprueba

function ventanasParciales(inicio: Date, fin: Date) {
  const t0 = inicio.getTime();
  const paso = Math.floor((fin.getTime() - t0) / 3);
  return [
    { inicio: new Date(t0), fin: new Date(t0 + paso) },
    { inicio: new Date(t0 + paso + DAY), fin: new Date(t0 + 2 * paso) },
    { inicio: new Date(t0 + 2 * paso + DAY), fin: new Date(fin.getTime()) },
  ];
}

function fechasClase(inicio: Date, fin: Date, n: number): Date[] {
  const t0 = inicio.getTime();
  const paso = Math.max(DAY, Math.floor((fin.getTime() - t0) / (n + 1)));
  return Array.from({ length: n }, (_, i) => new Date(t0 + (i + 1) * paso));
}

const soloFecha = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const hexAleatorio = (semilla: number) =>
  Array.from({ length: 64 }, (_, i) => (((semilla * 31 + i * 17) % 16) >>> 0).toString(16)).join('');

async function limpiar() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "workflow_event","audit_log","acta","punto_extra","examen","calificacion",
      "actividad","criterio","parcial","asistencia","curso","cadete","usuario",
      "periodo","grupo","materia","Plantel"
    RESTART IDENTITY CASCADE;
  `);
}

interface CursoSeed {
  id: string;
  docenteId: string;
  grupoId: string;
  parciales: { id: string; numero: number }[];
}

async function crearCurso(materiaId: string, grupoId: string, docenteId: string, periodo: { id: string; fechaInicio: Date; fechaFin: Date }): Promise<CursoSeed> {
  const curso = await prisma.curso.create({ data: { materiaId, grupoId, docenteId, periodoId: periodo.id } });
  const ventanas = ventanasParciales(periodo.fechaInicio, periodo.fechaFin);
  const parciales: { id: string; numero: number }[] = [];
  for (const numero of [1, 2, 3]) {
    const v = ventanas[numero - 1];
    const parcial = await prisma.parcial.create({
      data: { cursoId: curso.id, numero, pesoTI: PESOS.ti, pesoTE: PESOS.te, pesoTA: PESOS.ta, pesoEX: PESOS.ex, fechaInicio: v.inicio, fechaFin: v.fin },
    });
    const macro: Record<TipoCategoria, number> = { TI: PESOS.ti, TE: PESOS.te, TA: PESOS.ta };
    await prisma.criterio.createMany({
      data: TIPOS.flatMap((tipo) => Array.from({ length: 5 }, (_, i) => ({ parcialId: parcial.id, tipo, orden: i + 1, nombre: `${tipo} ${i + 1}`, peso: macro[tipo] / 5 }))),
    });
    parciales.push({ id: parcial.id, numero });
  }
  return { id: curso.id, docenteId, grupoId, parciales };
}

interface PlanParcial {
  fail?: boolean; // reprueba (grados bajos + examen bajo)
  np?: boolean; // examen No Presentó
  sde?: boolean; // 3+ faltas → SDE (sin examen)
}
type PlanFn = (idx: number, numero: number) => PlanParcial;

// Puebla actividades, calificaciones, exámenes y asistencia de los parciales indicados.
async function poblarParciales(
  curso: CursoSeed,
  cadetesActivos: { matricula: string }[],
  numeros: number[],
  plan: PlanFn,
  opts: { incluirHoy?: boolean } = {},
) {
  const ventanas = await prisma.parcial.findMany({ where: { cursoId: curso.id }, select: { id: true, numero: true, fechaInicio: true, fechaFin: true } });
  for (const numero of numeros) {
    const parcial = ventanas.find((p) => p.numero === numero)!;
    // 2 actividades por categoría (6 en total).
    const actividades: { id: string; tipo: TipoCategoria }[] = [];
    for (const tipo of TIPOS) {
      for (const orden of [1, 2]) {
        const a = await prisma.actividad.create({ data: { parcialId: parcial.id, tipo, orden, nombre: `${tipo} ${orden}` } });
        actividades.push({ id: a.id, tipo });
      }
    }
    const califs: { cadeteMatricula: string; actividadId: string; valor: number; capturadaPor: string }[] = [];
    const examenes: { cadeteMatricula: string; parcialId: string; tipo: 'Parcial'; valor: number | null; estatus: 'PRESENTADO' | 'NP'; capturadoPor: string }[] = [];
    cadetesActivos.forEach((cad, idx) => {
      const p = plan(idx, numero);
      const nivel = p.fail ? BAJO(idx) : ALTO(idx);
      for (const a of actividades) califs.push({ cadeteMatricula: cad.matricula, actividadId: a.id, valor: nivel, capturadaPor: curso.docenteId });
      if (p.sde) return; // SDE: sin examen (bloqueado)
      if (p.np) examenes.push({ cadeteMatricula: cad.matricula, parcialId: parcial.id, tipo: 'Parcial', valor: null, estatus: 'NP', capturadoPor: curso.docenteId });
      else examenes.push({ cadeteMatricula: cad.matricula, parcialId: parcial.id, tipo: 'Parcial', valor: p.fail ? BAJO(idx) : ALTO(idx), estatus: 'PRESENTADO', capturadoPor: curso.docenteId });
    });
    await prisma.calificacion.createMany({ data: califs });
    if (examenes.length) await prisma.examen.createMany({ data: examenes });

    // Asistencia: ~10 días de clase por parcial; el parcial 1 incluye hoy si se pide.
    const fechas = fechasClase(parcial.fechaInicio!, parcial.fechaFin!, 10).map(soloFecha);
    if (opts.incluirHoy && numero === 1) fechas[fechas.length - 1] = soloFecha(new Date());
    const asis: { cadeteMatricula: string; cursoId: string; fecha: Date; codigo: CodigoAsistencia; capturadaPor: string }[] = [];
    fechas.forEach((f, di) => {
      cadetesActivos.forEach((cad, ci) => {
        const p = plan(ci, numero);
        let codigo: CodigoAsistencia = 'A';
        if (p.sde && di < 3) codigo = 'F';
        else if (ci % 7 === 0 && di % 5 === 0) codigo = 'R';
        else if (ci % 11 === 0 && di % 4 === 0) codigo = 'J';
        asis.push({ cadeteMatricula: cad.matricula, cursoId: curso.id, fecha: f, codigo, capturadaPor: curso.docenteId });
      });
    });
    await prisma.asistencia.createMany({ data: asis, skipDuplicates: true });
  }
}

async function main() {
  await limpiar();
  const hash = await bcrypt.hash(PASSWORD, BCRYPT_COST);
  const hoy = new Date();

  // 1) Planteles
  const bm = await prisma.plantel.create({ data: { clave: 'BM', nombre: 'Bordes Mangel', activo: true } });
  const bc = await prisma.plantel.create({ data: { clave: 'BC', nombre: 'Bonilla Colmenero', activo: true } });

  // 2) Catálogo de materias
  await prisma.materia.createMany({ data: MATERIAS });
  const materias = await prisma.materia.findMany({ orderBy: { clave: 'asc' } });
  const M = (i: number) => materias[i % materias.length].id;

  // 3) Usuarios (todos entran directo salvo uno que prueba el cambio obligatorio)
  const U = async (email: string, nombreCompleto: string, rol: 'Operador' | 'Coordinador' | 'Docente', plantelId: string | null, debeCambiar = false) =>
    prisma.usuario.create({ data: { email, nombreCompleto, rol, plantelId, hashContrasena: hash, debeCambiarContrasena: debeCambiar } });

  const operador = await U('operador@sga.local', 'Operador del Sistema', 'Operador', null);
  const coordBM = await U('coord.bm@sga.local', 'Cnl. Ramírez · Coordinación BM', 'Coordinador', bm.id);
  const coordBC = await U('coord.bc@sga.local', 'Mtra. Ochoa · Coordinación BC', 'Coordinador', bc.id);
  const docMat = await U('mat.bm@sga.local', 'Prof. Alejandro Ríos (Matemáticas)', 'Docente', bm.id);
  const docHis = await U('his.bm@sga.local', 'Profa. Lucía Fuentes (Historia)', 'Docente', bm.id);
  const docFis = await U('fis.bm@sga.local', 'Prof. Daniel Cabrera (Física)', 'Docente', bm.id);
  await U('nuevo.bm@sga.local', 'Prof. de Nuevo Ingreso', 'Docente', bm.id, true); // prueba cambio de contraseña
  const docBC1 = await U('doc1.bc@sga.local', 'Prof. Mario Salazar', 'Docente', bc.id);
  const docBC2 = await U('doc2.bc@sga.local', 'Profa. Elena Vega', 'Docente', bc.id);

  // 4) Periodos: activo (rango contiene hoy) + inactivo previo, por plantel
  const inicio = new Date(hoy.getTime() - 60 * DAY);
  const fin = new Date(hoy.getTime() + 120 * DAY);
  const periodoBM = await prisma.periodo.create({ data: { plantelId: bm.id, codigo: '2025-2026-1', fechaInicio: inicio, fechaFin: fin, activo: true } });
  await prisma.periodo.create({ data: { plantelId: bm.id, codigo: '2024-2025-2', fechaInicio: new Date(hoy.getTime() - 240 * DAY), fechaFin: new Date(hoy.getTime() - 70 * DAY), activo: false } });
  const periodoBC = await prisma.periodo.create({ data: { plantelId: bc.id, codigo: '2025-2026-1', fechaInicio: inicio, fechaFin: fin, activo: true } });
  await prisma.periodo.create({ data: { plantelId: bc.id, codigo: '2024-2025-2', fechaInicio: new Date(hoy.getTime() - 240 * DAY), fechaFin: new Date(hoy.getTime() - 70 * DAY), activo: false } });

  // 5) Grupos + cadetes (30 por grupo; 27 activos, 2 baja temporal, 1 baja definitiva)
  async function crearGrupo(plantelId: string, clavePlantel: string, nombre: string, semestre: number) {
    const grupo = await prisma.grupo.create({ data: { plantelId, nombre, semestre, activo: true } });
    const cadetes = Array.from({ length: CADETES_POR_GRUPO }, (_, i) => {
      const estatus = i === CADETES_POR_GRUPO - 1 ? 'BajaDefinitiva' : i >= CADETES_POR_GRUPO - 3 ? 'BajaTemporal' : 'Activo';
      return {
        matricula: `${clavePlantel}-${nombre}-${pad3(i + 1)}`,
        nombreCompleto: nombreCadete(i),
        plantelId,
        grupoActualId: grupo.id,
        estatus: estatus as 'Activo' | 'BajaTemporal' | 'BajaDefinitiva',
        fechaBaja: estatus === 'BajaDefinitiva' ? hoy : null,
      };
    });
    await prisma.cadete.createMany({ data: cadetes });
    const activos = cadetes.filter((c) => c.estatus === 'Activo').map((c) => ({ matricula: c.matricula }));
    return { grupo, activos };
  }

  const g1A = await crearGrupo(bm.id, 'BM', '1A', 1);
  const g3A = await crearGrupo(bm.id, 'BM', '3A', 3);
  const g5A = await crearGrupo(bm.id, 'BM', '5A', 5);
  const gBC1A = await crearGrupo(bc.id, 'BC', '1A', 1);
  const gBC3B = await crearGrupo(bc.id, 'BC', '3B', 3);

  // 6) Cursos y su poblado por estados
  const ev0: PlanFn = () => ({}); // todos aprueban
  const eventos: { parcialId: string; accion: string; usuarioId: string; motivo?: string; timestamp: Date }[] = [];
  const audit: { tipoEvento: string; usuarioId: string; entidad: string; entidadId: string; timestamp: Date }[] = [];
  const ev = (parcialId: string, accion: string, usuarioId: string, dias: number, motivo?: string) => {
    eventos.push({ parcialId, accion, usuarioId, motivo, timestamp: new Date(hoy.getTime() - dias * DAY) });
    const map: Record<string, string> = { cerrar: 'PARCIAL_CERRAR', validar: 'PARCIAL_VALIDAR', devolver: 'PARCIAL_DEVOLVER', reabrir: 'PARCIAL_REABRIR' };
    audit.push({ tipoEvento: map[accion], usuarioId, entidad: 'Parcial', entidadId: parcialId, timestamp: new Date(hoy.getTime() - dias * DAY) });
  };
  const setEstado = (id: string, estado: EstadoParcial) => prisma.parcial.update({ where: { id }, data: { estado } });

  // --- CURSO A (BM · Matemáticas · 1A) — mitad de semestre: P1 Validado, P2 Cerrado, P3 Borrador
  const cursoA = await crearCurso(M(0), g1A.grupo.id, docMat.id, periodoBM);
  const planA: PlanFn = (i) => (i === 2 ? { sde: true } : i === 3 ? { np: true } : {});
  await poblarParciales(cursoA, g1A.activos, [1, 2], planA, { incluirHoy: true });
  await setEstado(cursoA.parciales[0].id, 'Validado');
  await setEstado(cursoA.parciales[1].id, 'CerradoDocente');
  ev(cursoA.parciales[0].id, 'cerrar', docMat.id, 20);
  ev(cursoA.parciales[0].id, 'validar', coordBM.id, 18);
  ev(cursoA.parciales[1].id, 'cerrar', docMat.id, 4);
  await prisma.puntoExtra.create({ data: { cadeteMatricula: g1A.activos[0].matricula, parcialId: cursoA.parciales[0].id, aplica: true, motivo: 'Participación destacada' } });

  // --- CURSO B (BM · Historia · 1A) — 3 validados, acta v1 firmada SOLO por docente
  const cursoB = await crearCurso(M(1), g1A.grupo.id, docHis.id, periodoBM);
  await poblarParciales(cursoB, g1A.activos, [1, 2, 3], ev0);
  for (const p of cursoB.parciales) { await setEstado(p.id, 'Validado'); ev(p.id, 'cerrar', docHis.id, 22); ev(p.id, 'validar', coordBM.id, 20); }
  const actaB = await prisma.acta.create({ data: { cursoId: cursoB.id, version: 1, firmadaDocenteEn: new Date(hoy.getTime() - 10 * DAY), hashPdf: hexAleatorio(11) } });
  audit.push({ tipoEvento: 'ACTA_FIRMA', usuarioId: docHis.id, entidad: 'Acta', entidadId: actaB.id, timestamp: new Date(hoy.getTime() - 10 * DAY) });

  // --- CURSO C (BM · 3A) — 3 validados, acta v1 DOBLE firma + hash + recuperaciones (RN-04)
  const cursoC = await crearCurso(M(2), g3A.grupo.id, docMat.id, periodoBM);
  const planC: PlanFn = (i, n) => (i === 0 && n === 1 ? { fail: true } : i === 1 && (n === 1 || n === 2) ? { fail: true } : {}); // idx0 reprueba 1; idx1 reprueba 2
  await poblarParciales(cursoC, g3A.activos, [1, 2, 3], planC);
  for (const p of cursoC.parciales) { await setEstado(p.id, 'Validado'); ev(p.id, 'validar', coordBM.id, 25); }
  const p3C = cursoC.parciales[2].id;
  await prisma.examen.createMany({
    data: [
      { cadeteMatricula: g3A.activos[0].matricula, parcialId: p3C, tipo: 'Ordinario', valor: 7, estatus: 'PRESENTADO', capturadoPor: docMat.id },
      { cadeteMatricula: g3A.activos[1].matricula, parcialId: p3C, tipo: 'Extraordinario', valor: 6, estatus: 'PRESENTADO', capturadoPor: docMat.id },
    ],
  });
  const actaC = await prisma.acta.create({ data: { cursoId: cursoC.id, version: 1, firmadaDocenteEn: new Date(hoy.getTime() - 8 * DAY), firmadaCoordinacionEn: new Date(hoy.getTime() - 7 * DAY), hashPdf: hexAleatorio(3) } });
  audit.push({ tipoEvento: 'RECUPERACION_CAPTURA', usuarioId: docMat.id, entidad: 'Examen', entidadId: actaC.id, timestamp: new Date(hoy.getTime() - 9 * DAY) });
  audit.push({ tipoEvento: 'ACTA_FIRMA', usuarioId: coordBM.id, entidad: 'Acta', entidadId: actaC.id, timestamp: new Date(hoy.getTime() - 7 * DAY) });

  // --- CURSO E (BM · Física · 1A) — Borrador fresco: hoy con asistencia + cierre próximo (dashboard docente)
  const cursoE = await crearCurso(M(3), g1A.grupo.id, docFis.id, periodoBM);
  await poblarParciales(cursoE, g1A.activos, [1], ev0, { incluirHoy: true });
  await prisma.parcial.update({ where: { id: cursoE.parciales[0].id }, data: { fechaFin: soloFecha(new Date(hoy.getTime() + 4 * DAY)) } });

  // --- Cursos BM adicionales en Borrador (para poblar el hub de Cursos y paneles)
  await crearCurso(M(4), g5A.grupo.id, docFis.id, periodoBM);
  await crearCurso(M(5), g3A.grupo.id, docHis.id, periodoBM);

  // --- CURSO D (BC · 1A) — parcial 2 REABIERTO; acta v1 (previa) + v2 (vigente, sin firmar)
  const cursoD = await crearCurso(M(6), gBC1A.grupo.id, docBC1.id, periodoBC);
  await poblarParciales(cursoD, gBC1A.activos, [1, 2, 3], ev0);
  await setEstado(cursoD.parciales[0].id, 'Validado');
  await setEstado(cursoD.parciales[2].id, 'Validado');
  await setEstado(cursoD.parciales[1].id, 'Reabierto');
  ev(cursoD.parciales[0].id, 'validar', coordBC.id, 30);
  ev(cursoD.parciales[2].id, 'validar', coordBC.id, 30);
  ev(cursoD.parciales[1].id, 'reabrir', coordBC.id, 5, 'Corrección de calificación mal capturada en el examen del segundo parcial.');
  await prisma.acta.create({ data: { cursoId: cursoD.id, version: 1, firmadaDocenteEn: new Date(hoy.getTime() - 28 * DAY), firmadaCoordinacionEn: new Date(hoy.getTime() - 27 * DAY), hashPdf: hexAleatorio(1) } });
  await prisma.acta.create({ data: { cursoId: cursoD.id, version: 2, hashPdf: hexAleatorio(2) } });

  // --- CURSO I (BC · 3B) — P1 Validado, resto Borrador (sin acta aún)
  const cursoI = await crearCurso(M(7), gBC3B.grupo.id, docBC2.id, periodoBC);
  await poblarParciales(cursoI, gBC3B.activos, [1], ev0);
  await setEstado(cursoI.parciales[0].id, 'Validado');
  ev(cursoI.parciales[0].id, 'cerrar', docBC2.id, 6);
  ev(cursoI.parciales[0].id, 'validar', coordBC.id, 5);
  await crearCurso(M(8), gBC3B.grupo.id, docBC2.id, periodoBC); // otro Borrador

  // 7) Bitácora: eventos de workflow + auditoría (logins, capturas, desbloqueo, reasignación)
  await prisma.workflowEvent.createMany({ data: eventos });
  audit.push(
    { tipoEvento: 'LOGIN_OK', usuarioId: operador.id, entidad: 'Usuario', entidadId: operador.id, timestamp: new Date(hoy.getTime() - 1 * DAY) },
    { tipoEvento: 'LOGIN_OK', usuarioId: coordBM.id, entidad: 'Usuario', entidadId: coordBM.id, timestamp: new Date(hoy.getTime() - 1 * DAY) },
    { tipoEvento: 'LOGIN_OK', usuarioId: docMat.id, entidad: 'Usuario', entidadId: docMat.id, timestamp: new Date(hoy.getTime() - 2 * DAY) },
    { tipoEvento: 'DESBLOQUEO', usuarioId: coordBM.id, entidad: 'Usuario', entidadId: docFis.id, timestamp: new Date(hoy.getTime() - 3 * DAY) },
    { tipoEvento: 'REASIGNAR_DOCENTE', usuarioId: coordBM.id, entidad: 'Curso', entidadId: cursoA.id, timestamp: new Date(hoy.getTime() - 12 * DAY) },
    { tipoEvento: 'CALIFICACION_CAPTURA', usuarioId: docMat.id, entidad: 'Parcial', entidadId: cursoA.parciales[0].id, timestamp: new Date(hoy.getTime() - 19 * DAY) },
    { tipoEvento: 'EXAMEN_CAPTURA', usuarioId: docMat.id, entidad: 'Parcial', entidadId: cursoA.parciales[0].id, timestamp: new Date(hoy.getTime() - 19 * DAY) },
  );
  await prisma.auditLog.createMany({ data: audit.map((a) => ({ ...a, ip: '10.0.0.1' })) });

  const cursos = await prisma.curso.count();
  const cadetes = await prisma.cadete.count();
  console.log('── Seed de DEMO completo ──');
  console.log(`Planteles: 2 | Grupos: 5 | Cadetes: ${cadetes} | Cursos: ${cursos} | Materias: ${materias.length}`);
  console.log(`Contraseña de todos los usuarios: ${PASSWORD}`);
  console.log('Roles para revisar:');
  console.log('  operador@sga.local   (Operador — vista global, elige plantel en Catálogos)');
  console.log('  coord.bm@sga.local   (Coordinación BM — validar/reabrir, cadetes, catálogos, bitácora)');
  console.log('  mat.bm@sga.local     (Docente Matemáticas — cursos, asistencia, calificaciones, acta)');
  console.log('  his.bm@sga.local · fis.bm@sga.local · coord.bc@sga.local · doc1.bc@sga.local');
  console.log('  nuevo.bm@sga.local   (Docente — fuerza cambio de contraseña en el primer ingreso)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
