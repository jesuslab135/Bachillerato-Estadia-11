import { afterAll, describe, expect, it } from 'vitest';
import { makeCurso, insertParcialRaw, prisma, uniq } from './helpers';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Asistencia: única por (cadete, curso, fecha)', () => {
  it('rechaza una segunda asistencia para el mismo (cadete, curso, fecha)', async () => {
    const { cadete, curso, docente } = await makeCurso();
    const fecha = new Date('2025-09-01');
    await prisma.asistencia.create({
      data: { cadeteMatricula: cadete.matricula, cursoId: curso.id, fecha, codigo: 'A', capturadaPor: docente.id },
    });
    await expect(
      prisma.asistencia.create({
        data: { cadeteMatricula: cadete.matricula, cursoId: curso.id, fecha, codigo: 'F', capturadaPor: docente.id },
      }),
    ).rejects.toThrow();
  });
});

describe('RN-02 — peso_EX ∈ [0.20, 0.70] como invariante del parcial cerrado', () => {
  it('permite 0.20 y 0.70 en un parcial cerrado', async () => {
    const { curso } = await makeCurso();
    await expect(
      insertParcialRaw({ cursoId: curso.id, numero: 1, estado: 'CerradoDocente', pesoTI: 0.2, pesoTE: 0.3, pesoTA: 0.3, pesoEX: 0.2 }),
    ).resolves.not.toThrow();
    await expect(
      insertParcialRaw({ cursoId: curso.id, numero: 2, estado: 'CerradoDocente', pesoTI: 0.1, pesoTE: 0.1, pesoTA: 0.1, pesoEX: 0.7 }),
    ).resolves.not.toThrow();
  });

  it('rechaza 0.19 y 0.71 en un parcial cerrado (CHECK del servidor)', async () => {
    const { curso } = await makeCurso();
    await expect(
      insertParcialRaw({ cursoId: curso.id, numero: 1, estado: 'CerradoDocente', pesoTI: 0.21, pesoTE: 0.3, pesoTA: 0.3, pesoEX: 0.19 }),
    ).rejects.toThrow();
    await expect(
      insertParcialRaw({ cursoId: curso.id, numero: 2, estado: 'Validado', pesoTI: 0.1, pesoTE: 0.09, pesoTA: 0.1, pesoEX: 0.71 }),
    ).rejects.toThrow();
  });

  it('permite peso_EX fuera de rango mientras el parcial está en Borrador (edición)', async () => {
    const { curso } = await makeCurso();
    await expect(
      insertParcialRaw({ cursoId: curso.id, numero: 1, estado: 'Borrador', pesoTI: 0.4, pesoTE: 0.3, pesoTA: 0.2, pesoEX: 0.1 }),
    ).resolves.not.toThrow();
  });
});

describe('Pesos suman 1.0 en parcial cerrado', () => {
  it('rechaza pesos que no suman 1.0 al cerrar', async () => {
    const { curso } = await makeCurso();
    await expect(
      insertParcialRaw({ cursoId: curso.id, numero: 1, estado: 'CerradoDocente', pesoTI: 0.3, pesoTE: 0.3, pesoTA: 0.3, pesoEX: 0.3 }),
    ).rejects.toThrow();
  });
});

describe('Calificación: valor ∈ [0, 10]', () => {
  it('rechaza valor > 10', async () => {
    const { cadete, curso } = await makeCurso();
    const parcial = await prisma.parcial.create({
      data: { cursoId: curso.id, numero: 1, pesoTI: 0.3, pesoTE: 0.3, pesoTA: 0.1, pesoEX: 0.3 },
    });
    const actividad = await prisma.actividad.create({
      data: { parcialId: parcial.id, tipo: 'TI', orden: 1, nombre: 'A1' },
    });
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO calificacion (id, cadete_matricula, actividad_id, valor, capturada_por)
         VALUES (gen_random_uuid(), $1, $2, 10.5, 'x')`,
        cadete.matricula,
        actividad.id,
      ),
    ).rejects.toThrow();
  });
});

describe('Examen: NP ⇔ valor null', () => {
  it('rechaza estatus NP con valor no nulo', async () => {
    const { cadete, curso } = await makeCurso();
    const parcial = await prisma.parcial.create({
      data: { cursoId: curso.id, numero: 1, pesoTI: 0.3, pesoTE: 0.3, pesoTA: 0.1, pesoEX: 0.3 },
    });
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO examen (id, cadete_matricula, parcial_id, tipo, valor, estatus, capturado_por)
         VALUES (gen_random_uuid(), $1, $2, 'Parcial'::"TipoExamen", 7.0, 'NP'::"EstatusExamen", 'x')`,
        cadete.matricula,
        parcial.id,
      ),
    ).rejects.toThrow();
  });

  it('acepta NP con valor null y PRESENTADO con valor', async () => {
    const { cadete, curso } = await makeCurso();
    const parcial = await prisma.parcial.create({
      data: { cursoId: curso.id, numero: 1, pesoTI: 0.3, pesoTE: 0.3, pesoTA: 0.1, pesoEX: 0.3 },
    });
    const np = await prisma.examen.create({
      data: { cadeteMatricula: cadete.matricula, parcialId: parcial.id, tipo: 'Parcial', valor: null, estatus: 'NP', capturadoPor: 'x' },
    });
    expect(np.estatus).toBe('NP');
    const ok = await prisma.examen.create({
      data: { cadeteMatricula: cadete.matricula, parcialId: parcial.id, tipo: 'Ordinario', valor: '8.5', estatus: 'PRESENTADO', capturadoPor: 'x' },
    });
    expect(ok.valor?.toString()).toBe('8.5');
  });
});

describe('Periodo: solo uno activo por plantel', () => {
  it('rechaza un segundo periodo activo en el mismo plantel', async () => {
    const plantel = await prisma.plantel.create({ data: { clave: uniq('PL'), nombre: 'P' } });
    await prisma.periodo.create({
      data: { plantelId: plantel.id, codigo: uniq('C'), fechaInicio: new Date('2025-08-01'), fechaFin: new Date('2026-06-30'), activo: true },
    });
    await expect(
      prisma.periodo.create({
        data: { plantelId: plantel.id, codigo: uniq('C'), fechaInicio: new Date('2026-08-01'), fechaFin: new Date('2027-06-30'), activo: true },
      }),
    ).rejects.toThrow();
  });

  it('permite varios periodos inactivos en el mismo plantel', async () => {
    const plantel = await prisma.plantel.create({ data: { clave: uniq('PL'), nombre: 'P' } });
    await prisma.periodo.create({
      data: { plantelId: plantel.id, codigo: uniq('C'), fechaInicio: new Date('2025-08-01'), fechaFin: new Date('2026-06-30'), activo: false },
    });
    await expect(
      prisma.periodo.create({
        data: { plantelId: plantel.id, codigo: uniq('C'), fechaInicio: new Date('2026-08-01'), fechaFin: new Date('2027-06-30'), activo: false },
      }),
    ).resolves.toBeDefined();
  });
});

describe('AuditLog: append-only', () => {
  it('rechaza UPDATE y DELETE sobre audit_log', async () => {
    const row = await prisma.auditLog.create({
      data: { tipoEvento: 'TEST', entidad: 'Cadete', entidadId: 'x' },
    });
    await expect(
      prisma.$executeRawUnsafe(`UPDATE audit_log SET tipo_evento = 'HACK' WHERE id = $1`, row.id),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM audit_log WHERE id = $1`, row.id),
    ).rejects.toThrow();
  });
});
