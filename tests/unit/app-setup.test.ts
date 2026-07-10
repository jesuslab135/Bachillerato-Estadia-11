import { describe, expect, it } from 'vitest';
import { origenesCors, saltosProxy } from '../../src/app.setup';
import { exigirJwtSecret } from '../../src/auth/auth.module';

describe('origenesCors (FB-B-5 — CORS saneado)', () => {
  it('parsea la lista separada por comas con trim y sin vacíos', () => {
    expect(origenesCors(' https://a.com , https://b.com ,, ', true)).toEqual(['https://a.com', 'https://b.com']);
  });

  it('sin variable: en producción NO refleja ningún origen', () => {
    expect(origenesCors(undefined, true)).toBe(false);
    expect(origenesCors('', true)).toBe(false);
    expect(origenesCors(' , ', true)).toBe(false);
  });

  it('sin variable: fuera de producción mantiene el modo permisivo (dev)', () => {
    expect(origenesCors(undefined, false)).toBe(true);
    expect(origenesCors('', false)).toBe(true);
  });
});

describe('saltosProxy (despliegue — trust proxy tras nginx)', () => {
  it('sin variable, "0" o "false": no confía en ningún proxy', () => {
    expect(saltosProxy(undefined)).toBe(0);
    expect(saltosProxy('')).toBe(0);
    expect(saltosProxy('0')).toBe(0);
    expect(saltosProxy('false')).toBe(0);
    expect(saltosProxy(' FALSE ')).toBe(0);
  });

  it('"true" equivale a 1 salto', () => {
    expect(saltosProxy('true')).toBe(1);
    expect(saltosProxy(' TRUE ')).toBe(1);
  });

  it('acepta números enteros positivos de saltos', () => {
    expect(saltosProxy('1')).toBe(1);
    expect(saltosProxy(' 2 ')).toBe(2);
  });

  it('valores inválidos o negativos no confían en ningún proxy', () => {
    expect(saltosProxy('-1')).toBe(0);
    expect(saltosProxy('1.5')).toBe(0);
    expect(saltosProxy('nginx')).toBe(0);
  });
});

describe('exigirJwtSecret (FB-B-5 — fail-fast sin JWT_SECRET)', () => {
  it('devuelve el secreto cuando está definido', () => {
    expect(exigirJwtSecret('super-secreto')).toBe('super-secreto');
  });

  it('lanza si falta o está vacío (el proceso no debe arrancar)', () => {
    expect(() => exigirJwtSecret(undefined)).toThrow(/JWT_SECRET/);
    expect(() => exigirJwtSecret('')).toThrow(/JWT_SECRET/);
    expect(() => exigirJwtSecret('   ')).toThrow(/JWT_SECRET/);
  });
});
