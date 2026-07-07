import { describe, expect, it } from 'vitest';
import { celdaCsv, parseCsv } from '../../src/common/csv';

describe('parseCsv (FB-B-7 — RFC 4180)', () => {
  it('parsea un CSV simple con encabezado', () => {
    expect(parseCsv('a,b\n1,2\n3,4')).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });

  it('soporta comas dentro de campos entrecomillados ("Pérez, Juan")', () => {
    const filas = parseCsv('matricula,nombreCompleto\nM1,"Pérez, Juan"');
    expect(filas).toEqual([{ matricula: 'M1', nombreCompleto: 'Pérez, Juan' }]);
  });

  it('soporta comillas escapadas ("" dentro de comillas)', () => {
    const filas = parseCsv('a,b\n"dijo ""hola""",x');
    expect(filas).toEqual([{ a: 'dijo "hola"', b: 'x' }]);
  });

  it('soporta saltos de línea dentro de comillas y finales CRLF', () => {
    const filas = parseCsv('a,b\r\n"linea1\nlinea2",x\r\n');
    expect(filas).toEqual([{ a: 'linea1\nlinea2', b: 'x' }]);
  });

  it('recorta espacios en campos sin comillas y rellena celdas faltantes', () => {
    expect(parseCsv('a,b,c\n 1 , 2 ')).toEqual([{ a: '1', b: '2', c: '' }]);
  });

  it('ignora líneas vacías y devuelve [] sin datos', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('a,b\n\n1,2\n\n')).toEqual([{ a: '1', b: '2' }]);
  });
});

describe('celdaCsv (FB-B-7 — escape RFC 4180 + anti-inyección de fórmulas)', () => {
  it('escapa comillas y envuelve campos con separadores', () => {
    expect(celdaCsv('a,b')).toBe('"a,b"');
    expect(celdaCsv('con "comillas"')).toBe('"con ""comillas"""');
    expect(celdaCsv('simple')).toBe('simple');
    expect(celdaCsv(null)).toBe('');
    expect(celdaCsv({ k: 1 })).toBe('"{""k"":1}"');
  });

  it("neutraliza celdas que empiezan con '=', '+', '-', '@' (prefijo ')", () => {
    expect(celdaCsv('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(celdaCsv('+1234')).toBe("'+1234");
    expect(celdaCsv('-cmd')).toBe("'-cmd");
    expect(celdaCsv('@import')).toBe("'@import");
    expect(celdaCsv('=HYPERLINK("x"),y')).toBe('"\'=HYPERLINK(""x""),y"');
  });
});
