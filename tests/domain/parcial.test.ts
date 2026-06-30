import { describe, expect, it } from 'vitest';
import {
  aplicarPiso5,
  calificacionCrudaParcial,
  calificacionFinalParcial,
  evaluacionContinua,
  examenPonderado,
  promedioCategoria,
  PesosParcial,
} from '@domain';

const PESOS: PesosParcial = { ti: 0.2, te: 0.2, ta: 0.2, ex: 0.4 };

describe('promedioCategoria — solo valores > 0', () => {
  it('ignora ceros, null y undefined', () => {
    expect(promedioCategoria([8, 0, 10, null, undefined, 6])).toBeCloseTo(8);
  });
  it('sin valores válidos ⇒ 0', () => {
    expect(promedioCategoria([0, 0])).toBe(0);
    expect(promedioCategoria([])).toBe(0);
  });
});

describe('evaluacionContinua', () => {
  it('suma ponderada de las tres categorías', () => {
    expect(evaluacionContinua(10, 8, 6, PESOS)).toBeCloseTo(4.8);
  });
});

describe('examenPonderado', () => {
  it('SDE ⇒ "SDE"', () => {
    expect(examenPonderado(8, 0.4, true)).toBe('SDE');
  });
  it('NP ⇒ 0', () => {
    expect(examenPonderado('NP', 0.4, false)).toBe(0);
  });
  it('numérico ⇒ examen * pesoEX', () => {
    expect(examenPonderado(8, 0.4, false)).toBeCloseTo(3.2);
  });
});

describe('calificacionCrudaParcial', () => {
  const base = { promTI: 8, promTE: 8, promTA: 8, pesos: PESOS } as const;
  it('SDE ⇒ solo evaluación continua', () => {
    expect(calificacionCrudaParcial({ ...base, examen: 9, sde: true })).toBeCloseTo(4.8);
  });
  it('con examen numérico ⇒ EC + examen ponderado', () => {
    expect(calificacionCrudaParcial({ ...base, examen: 7, sde: false })).toBeCloseTo(7.6);
  });
  it('examen NP ⇒ EC + 0', () => {
    expect(calificacionCrudaParcial({ ...base, examen: 'NP', sde: false })).toBeCloseTo(4.8);
  });
});

describe('RN-03 — piso de 5', () => {
  it.each([
    [4.9, 4.9],
    [5.0, 5],
    [5.4, 5],
    [5.9, 5],
    [6.0, 6],
    [6.1, 6.1],
  ])('aplicarPiso5(%s) = %s', (cruda, esperado) => {
    expect(aplicarPiso5(cruda)).toBeCloseTo(esperado);
  });
});

describe('calificacionFinalParcial — piso → round → +punto extra (cap 10)', () => {
  it.each([
    [5.4, false, 5],
    [5.9, false, 5],
    [4.9, false, 5],
    [6.0, false, 6],
    [6.1, false, 6],
    [0, false, 0],
  ])('cruda %s sin punto extra ⇒ %s', (cruda, extra, esperado) => {
    expect(calificacionFinalParcial(cruda, extra)).toBe(esperado);
  });

  it('punto extra suma 1', () => {
    expect(calificacionFinalParcial(9.4, true)).toBe(10); // round(9.4)=9 +1
  });

  it('punto extra no supera 10 (tope)', () => {
    expect(calificacionFinalParcial(9.6, true)).toBe(10); // round(9.6)=10, +1 → cap 10
  });
});
