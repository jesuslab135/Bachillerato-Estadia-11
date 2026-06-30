import { describe, expect, it } from 'vitest';
import { calificacionFinalSemestre, observacionSemestral, NotaParcial } from '@domain';

const tripleta = (a: NotaParcial, b: NotaParcial, c: NotaParcial) =>
  [a, b, c] as readonly [NotaParcial, NotaParcial, NotaParcial];

describe('RN-04 — calificacionFinalSemestre (cascada)', () => {
  it('aprobó los 3 ⇒ ROUND(promedio)', () => {
    expect(calificacionFinalSemestre({ parciales: tripleta(8, 7, 9) })).toBe(8);
  });

  it('reprobó 1 + Ordinario ⇒ promedio recalculado reemplazando el reprobado', () => {
    expect(
      calificacionFinalSemestre({ parciales: tripleta(8, 4, 7), ordinario: 6 }),
    ).toBe(7); // (8+6+7)/3 = 7
  });

  it('reprobó 2 sin recuperación ⇒ ROUND(promedio de parciales)', () => {
    expect(calificacionFinalSemestre({ parciales: tripleta(8, 4, 3) })).toBe(5);
  });

  it('Extraordinario gobierna ⇒ nota directa', () => {
    expect(
      calificacionFinalSemestre({ parciales: tripleta(8, 4, 3), extraordinario: 7 }),
    ).toBe(7);
  });

  it('TDS gobierna sobre extraordinario y parciales ⇒ nota directa', () => {
    expect(
      calificacionFinalSemestre({ parciales: tripleta(3, 3, 3), extraordinario: 4, tds: 6 }),
    ).toBe(6);
  });

  it('NP en un parcial promedia como 0', () => {
    expect(calificacionFinalSemestre({ parciales: tripleta(8, 'NP', 7) })).toBe(5); // (8+0+7)/3=5
  });

  it('instancia "NP" o null es inválida y se ignora en la precedencia', () => {
    // ordinario NP/null inválido ⇒ cae al promedio de parciales
    expect(
      calificacionFinalSemestre({ parciales: tripleta(8, 4, 7), ordinario: 'NP' }),
    ).toBe(6); // (8+4+7)/3 = 6.33 → 6
    expect(
      calificacionFinalSemestre({ parciales: tripleta(8, 4, 7), tds: null, extraordinario: 'NP' }),
    ).toBe(6);
  });
});

describe('RN-04 — observacionSemestral', () => {
  it('aprobó los 3 ⇒ sin observación', () => {
    expect(observacionSemestral({ parciales: tripleta(8, 7, 9) })).toBe('');
  });

  it('reprobó 1 ⇒ "Presenta Ordinario"', () => {
    expect(observacionSemestral({ parciales: tripleta(8, 4, 7) })).toBe('Presenta Ordinario');
  });

  it('reprobó 2-3 ⇒ "Presenta Extraordinario"', () => {
    expect(observacionSemestral({ parciales: tripleta(8, 4, 3) })).toBe('Presenta Extraordinario');
    expect(observacionSemestral({ parciales: tripleta(2, 4, 3) })).toBe('Presenta Extraordinario');
  });

  it('reprobó el extraordinario ⇒ "Habilita TDS"', () => {
    expect(
      observacionSemestral({ parciales: tripleta(8, 4, 3), extraordinario: 4 }),
    ).toBe('Habilita TDS');
    expect(
      observacionSemestral({ parciales: tripleta(8, 4, 3), extraordinario: 'NP' }),
    ).toBe('Habilita TDS');
  });

  it('aprobó el extraordinario ⇒ sin observación', () => {
    expect(observacionSemestral({ parciales: tripleta(8, 4, 3), extraordinario: 7 })).toBe('');
  });

  it('extraordinario null se ignora; se evalúan los parciales', () => {
    expect(observacionSemestral({ parciales: tripleta(8, 7, 9), extraordinario: null })).toBe('');
  });
});
