import { describe, expect, it } from 'vitest';
import { criteriosSumanMacro, pesoExEnRango, pesosSumanUno } from '@domain';

describe('RN-02 — peso del examen en [0.20, 0.70]', () => {
  it.each([
    [0.19, false],
    [0.2, true],
    [0.7, true],
    [0.71, false],
  ])('pesoExEnRango(%s) = %s', (peso, esperado) => {
    expect(pesoExEnRango(peso)).toBe(esperado);
  });
});

describe('pesosSumanUno', () => {
  it('acepta suma exacta de 1.0', () => {
    expect(pesosSumanUno({ ti: 0.3, te: 0.3, ta: 0.1, ex: 0.3 })).toBe(true);
  });
  it('rechaza suma distinta de 1.0', () => {
    expect(pesosSumanUno({ ti: 0.3, te: 0.3, ta: 0.3, ex: 0.3 })).toBe(false);
  });
});

describe('criteriosSumanMacro', () => {
  it('acepta cuando los criterios igualan el peso macro', () => {
    expect(criteriosSumanMacro([0.06, 0.06, 0.06, 0.06, 0.06], 0.3)).toBe(true);
  });
  it('rechaza cuando no igualan el peso macro', () => {
    expect(criteriosSumanMacro([0.1, 0.1], 0.3)).toBe(false);
  });
});
