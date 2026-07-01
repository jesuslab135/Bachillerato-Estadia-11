/**
 * Seed de PRUEBA — limpia la DB y crea el mínimo necesario para probar TODO en el frontend.
 *
 * Uso (desde backend/):  npm run seed:test
 *
 * Limpia con TRUNCATE ... CASCADE (evita los triggers append-only de audit_log/workflow_event,
 * que rechazan DELETE pero no TRUNCATE) y siembra: 2 planteles, catálogo de materias, usuarios
 * (operador, coordinación por plantel y un docente), un grupo con cadetes, un periodo ACTIVO y
 * un curso completo (3 parciales + 15 criterios) para ejercer asistencia, calificaciones,
 * ponderación, workflow y acta.
 *
 * OJO: es destructivo. Solo para entornos de desarrollo/prueba.
 */
import { PrismaClient, TipoCategoria } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { MATERIAS } from '../prisma/catalogo-materias';

const prisma = new PrismaClient();

const PASSWORD = process.env.SEED_PASSWORD ?? 'SgaTemporal2026!';
const BCRYPT_COST = 12;
const UN_DIA_MS = 86_400_000;

// Pesos por defecto del parcial (idénticos a la creación de curso vía API).
const PESOS = { ti: 0.2, te: 0.2, ta: 0.2, ex: 0.4 };
const CRITERIOS_POR_TIPO = 5;
const TIPOS: TipoCategoria[] = ['TI', 'TE', 'TA'];

function ventanasParciales(inicio: Date, fin: Date) {
  const t0 = inicio.getTime();
  const paso = Math.floor((fin.getTime() - t0) / 3);
  const b1 = t0 + paso;
  const b2 = t0 + 2 * paso;
  return [
    { inicio: new Date(t0), fin: new Date(b1) },
    { inicio: new Date(b1 + UN_DIA_MS), fin: new Date(b2) },
    { inicio: new Date(b2 + UN_DIA_MS), fin: new Date(fin.getTime()) },
  ];
}

async function limpiar() {
  // TRUNCATE no dispara los triggers BEFORE DELETE (append-only), y CASCADE resuelve las FKs.
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "workflow_event","audit_log","acta","punto_extra","examen","calificacion",
      "actividad","criterio","parcial","asistencia","curso","cadete","usuario",
      "periodo","grupo","materia","Plantel"
    RESTART IDENTITY CASCADE;
  `);
}

async function main() {
  await limpiar();

  // 1) Planteles
  const bm = await prisma.plantel.create({ data: { clave: 'BM', nombre: 'Bordes Mangel', activo: true } });
  const bc = await prisma.plantel.create({ data: { clave: 'BC', nombre: 'Bonilla Colmenero', activo: true } });

  // 2) Catálogo de materias
  await prisma.materia.createMany({ data: MATERIAS });
  const mat1 = await prisma.materia.findFirstOrThrow({ where: { clave: MATERIAS[0].clave } });

  // 3) Usuarios. Coordinación y operador entran directo (debeCambiar=false) para probar sin fricción;
  //    el docente arranca con cambio obligatorio para poder probar también RF-AUTH-04.
  const hash = await bcrypt.hash(PASSWORD, BCRYPT_COST);
  await prisma.usuario.createMany({
    data: [
      { email: 'operador@sga.local', nombreCompleto: 'Operador del Sistema', rol: 'Operador', plantelId: null, hashContrasena: hash, debeCambiarContrasena: false },
      { email: 'coord.bm@sga.local', nombreCompleto: 'Coordinación Bordes Mangel', rol: 'Coordinador', plantelId: bm.id, hashContrasena: hash, debeCambiarContrasena: false },
      { email: 'coord.bc@sga.local', nombreCompleto: 'Coordinación Bonilla Colmenero', rol: 'Coordinador', plantelId: bc.id, hashContrasena: hash, debeCambiarContrasena: false },
      { email: 'docente.bm@sga.local', nombreCompleto: 'Profe Bordes Mangel', rol: 'Docente', plantelId: bm.id, hashContrasena: hash, debeCambiarContrasena: true },
    ],
  });
  const docente = await prisma.usuario.findUniqueOrThrow({ where: { email: 'docente.bm@sga.local' } });

  // 4) Grupo en BM
  const grupo = await prisma.grupo.create({ data: { plantelId: bm.id, nombre: '1A', semestre: 1, activo: true } });

  // 5) Periodo ACTIVO cuyo rango contiene la fecha de hoy (para capturar asistencia del día en el parcial 1)
  const hoy = new Date();
  const inicio = new Date(hoy.getTime() - 15 * UN_DIA_MS);
  const fin = new Date(hoy.getTime() + 165 * UN_DIA_MS);
  const periodo = await prisma.periodo.create({
    data: { plantelId: bm.id, codigo: '2025-2026-1', fechaInicio: inicio, fechaFin: fin, activo: true },
  });

  // 6) Cadetes: 5 activos + 1 en baja definitiva (para ver el resaltado RN-05)
  const cadetes = [
    { matricula: 'BM-1A-001', nombreCompleto: 'Ana López', estatus: 'Activo' as const },
    { matricula: 'BM-1A-002', nombreCompleto: 'Bruno Díaz', estatus: 'Activo' as const },
    { matricula: 'BM-1A-003', nombreCompleto: 'Carla Ruiz', estatus: 'Activo' as const },
    { matricula: 'BM-1A-004', nombreCompleto: 'Diego Mora', estatus: 'Activo' as const },
    { matricula: 'BM-1A-005', nombreCompleto: 'Elena Vega', estatus: 'Activo' as const },
    { matricula: 'BM-1A-006', nombreCompleto: 'Fabián Roldán (baja)', estatus: 'BajaDefinitiva' as const },
  ];
  await prisma.cadete.createMany({
    data: cadetes.map((c) => ({ ...c, plantelId: bm.id, grupoActualId: grupo.id, fechaBaja: c.estatus === 'BajaDefinitiva' ? hoy : null })),
  });

  // 7) Curso completo: 3 parciales + 15 criterios/parcial (réplica de la creación vía API)
  const curso = await prisma.curso.create({
    data: { materiaId: mat1.id, grupoId: grupo.id, docenteId: docente.id, periodoId: periodo.id },
  });
  const ventanas = ventanasParciales(inicio, fin);
  for (const numero of [1, 2, 3]) {
    const v = ventanas[numero - 1];
    const parcial = await prisma.parcial.create({
      data: {
        cursoId: curso.id,
        numero,
        pesoTI: PESOS.ti,
        pesoTE: PESOS.te,
        pesoTA: PESOS.ta,
        pesoEX: PESOS.ex,
        fechaInicio: v.inicio,
        fechaFin: v.fin,
      },
    });
    const macro: Record<TipoCategoria, number> = { TI: PESOS.ti, TE: PESOS.te, TA: PESOS.ta };
    await prisma.criterio.createMany({
      data: TIPOS.flatMap((tipo) =>
        Array.from({ length: CRITERIOS_POR_TIPO }, (_, i) => ({
          parcialId: parcial.id,
          tipo,
          orden: i + 1,
          nombre: `${tipo} ${i + 1}`,
          peso: macro[tipo] / CRITERIOS_POR_TIPO,
        })),
      ),
    });
  }

  console.log('── Seed de prueba completo ──');
  console.log(`Planteles: BM, BC | Materias: ${MATERIAS.length} | Cadetes: ${cadetes.length} | Curso: ${mat1.clave} · 1A (3 parciales)`);
  console.log('Usuarios (contraseña: ' + PASSWORD + '):');
  console.log('  operador@sga.local     (Operador,    entra directo)');
  console.log('  coord.bm@sga.local     (Coordinador BM, entra directo)');
  console.log('  coord.bc@sga.local     (Coordinador BC, entra directo)');
  console.log('  docente.bm@sga.local   (Docente BM, pedirá cambiar contraseña — prueba RF-AUTH-04)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
