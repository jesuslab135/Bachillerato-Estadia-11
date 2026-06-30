import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from './helpers';
import { MATERIAS } from '../../prisma/catalogo-materias';

afterAll(async () => {
  await prisma.$disconnect();
});

// Requiere `npm run seed` previo (o `prisma migrate reset` que lo ejecuta).
describe('Seed inicial (RF-CAT-01 / RF-CAT-02)', () => {
  it('contiene los dos planteles iniciales por clave', async () => {
    const bm = await prisma.plantel.findUnique({ where: { clave: 'BM' } });
    const bc = await prisma.plantel.findUnique({ where: { clave: 'BC' } });
    expect(bm?.nombre).toBe('Bordes Mangel');
    expect(bc?.nombre).toBe('Bonilla Colmenero');
  });

  // Se verifica el catálogo por sus claves conocidas (no un conteo global) para no
  // contaminarse con las materias efímeras que crean las pruebas de constraints.
  it('el catálogo tiene exactamente 33 materias con claves únicas', () => {
    const claves = new Set(MATERIAS.map((m) => m.clave));
    expect(MATERIAS).toHaveLength(33);
    expect(claves.size).toBe(33);
  });

  it('el seed persistió las 33 materias del catálogo con clave y semestre 1..6', async () => {
    const claves = MATERIAS.map((m) => m.clave);
    const persistidas = await prisma.materia.findMany({ where: { clave: { in: claves } } });
    expect(persistidas).toHaveLength(33);
    for (const m of persistidas) {
      expect(m.clave).toBeTruthy();
      expect(m.semestreAplicable).toBeGreaterThanOrEqual(1);
      expect(m.semestreAplicable).toBeLessThanOrEqual(6);
    }
  });
});
