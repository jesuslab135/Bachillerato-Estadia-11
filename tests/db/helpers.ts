import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

let counter = 0;
export const uniq = (p: string) => `${p}-${Date.now()}-${counter++}`;

/** Crea un Plantel + Grupo + Periodo + Docente + Curso mínimos para colgar pruebas. */
export async function makeCurso() {
  const plantel = await prisma.plantel.create({
    data: { clave: uniq('PL'), nombre: 'Plantel de prueba' },
  });
  const grupo = await prisma.grupo.create({
    data: { plantelId: plantel.id, nombre: uniq('G'), semestre: 2 },
  });
  const periodo = await prisma.periodo.create({
    data: {
      plantelId: plantel.id,
      codigo: uniq('2025-2026'),
      fechaInicio: new Date('2025-08-01'),
      fechaFin: new Date('2026-06-30'),
      activo: false,
    },
  });
  const materia = await prisma.materia.create({
    data: { clave: uniq('M'), nombre: 'Materia de prueba', semestreAplicable: 2 },
  });
  const docente = await prisma.usuario.create({
    data: {
      email: uniq('doc') + '@sga.local',
      nombreCompleto: 'Docente de prueba',
      rol: 'Docente',
      plantelId: plantel.id,
      hashContrasena: 'x',
    },
  });
  const curso = await prisma.curso.create({
    data: {
      materiaId: materia.id,
      grupoId: grupo.id,
      docenteId: docente.id,
      periodoId: periodo.id,
    },
  });
  const cadete = await prisma.cadete.create({
    data: {
      matricula: uniq('MAT'),
      nombreCompleto: 'Cadete de prueba',
      plantelId: plantel.id,
      grupoActualId: grupo.id,
    },
  });
  return { plantel, grupo, periodo, materia, docente, curso, cadete };
}

/** Inserta un Parcial vía SQL crudo para ejercer los CHECKs del servidor (no la validación de Prisma Client). */
export async function insertParcialRaw(opts: {
  cursoId: string;
  numero: number;
  estado: string;
  pesoTI: number;
  pesoTE: number;
  pesoTA: number;
  pesoEX: number;
}): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO parcial (id, curso_id, numero, estado, peso_ti, peso_te, peso_ta, peso_ex)
     VALUES (gen_random_uuid(), $1, $2, $3::"EstadoParcial", $4, $5, $6, $7)`,
    opts.cursoId,
    opts.numero,
    opts.estado,
    opts.pesoTI,
    opts.pesoTE,
    opts.pesoTA,
    opts.pesoEX,
  );
}
