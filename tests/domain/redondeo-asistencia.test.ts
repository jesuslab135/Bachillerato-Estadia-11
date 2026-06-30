import { describe, expect, it } from 'vitest';
import { porcentajeAsistencia, redondear } from '@domain';

describe('redondear (half-up)', () => {
  it.each([
    [5.5, 6],
    [6.5, 7],
    [7.5, 8],
    [5.0, 5],
    [5.4, 5],
    [4.9, 5],
    [0.5, 1],
    [0, 0],
  ])('redondear(%s) = %s', (entrada, esperado) => {
    expect(redondear(entrada)).toBe(esperado);
  });
});

describe('porcentajeAsistencia', () => {
  it('(A+R)/total, contando J en el total', () => {
    expect(porcentajeAsistencia({ A: 8, F: 1, R: 1, J: 0 })).toBeCloseTo(0.9);
    expect(porcentajeAsistencia({ A: 1, F: 0, R: 0, J: 1 })).toBeCloseTo(0.5);
  });

  it('sin sesiones registradas ⇒ 0', () => {
    expect(porcentajeAsistencia({ A: 0, F: 0, R: 0, J: 0 })).toBe(0);
  });
});
