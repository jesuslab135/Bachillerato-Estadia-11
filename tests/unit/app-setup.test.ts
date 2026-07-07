import { describe, expect, it } from 'vitest';
import { origenesCors } from '../../src/app.setup';
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
