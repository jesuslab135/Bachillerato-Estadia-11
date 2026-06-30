import { describe, expect, it } from 'vitest';
import { esSDE, tieneDerechoExamen } from '@domain';

describe('RN-01 — derecho a examen / SDE', () => {
  it('2 faltas ⇒ con derecho', () => {
    expect(tieneDerechoExamen(2)).toBe(true);
    expect(esSDE(2)).toBe(false);
  });

  it('3 faltas ⇒ SDE', () => {
    expect(tieneDerechoExamen(3)).toBe(false);
    expect(esSDE(3)).toBe(true);
  });

  it('4 faltas ⇒ SDE', () => {
    expect(esSDE(4)).toBe(true);
  });

  it('2 faltas + 1 retardo ⇒ con derecho (el retardo no cuenta como F)', () => {
    // El retardo no incrementa el conteo de faltas no justificadas.
    const faltasNoJustificadas = 2;
    expect(tieneDerechoExamen(faltasNoJustificadas)).toBe(true);
  });

  it('3 faltas y luego 1 cambia a J ⇒ restituye el derecho (reevaluación con 2)', () => {
    expect(esSDE(3)).toBe(true);
    expect(tieneDerechoExamen(2)).toBe(true);
  });
});
