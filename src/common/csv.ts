/**
 * FB-B-7 — Utilidades CSV compartidas.
 * - `parseCsv`: parser RFC 4180 (comas dentro de comillas, comillas escapadas "",
 *   saltos de línea dentro de comillas, finales CRLF).
 * - `celdaCsv`: escape RFC 4180 para exportación + neutralización de inyección de
 *   fórmulas (prefijo `'` cuando la celda empieza con `=`, `+`, `-` o `@`).
 */

const INICIO_FORMULA = ['=', '+', '-', '@'];

function parsearFilas(csv: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = '';
  let enComillas = false;
  let celdaEntreComillas = false;

  const cerrarCelda = () => {
    fila.push(celdaEntreComillas ? celda : celda.trim());
    celda = '';
    celdaEntreComillas = false;
  };
  const cerrarFila = () => {
    cerrarCelda();
    if (fila.some((c) => c.length > 0)) filas.push(fila);
    fila = [];
  };

  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (enComillas) {
      if (c === '"') {
        if (csv[i + 1] === '"') {
          celda += '"';
          i++;
        } else {
          enComillas = false;
        }
      } else {
        celda += c;
      }
    } else if (c === '"' && celda.trim() === '') {
      enComillas = true;
      celdaEntreComillas = true;
      celda = '';
    } else if (c === ',') {
      cerrarCelda();
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && csv[i + 1] === '\n') i++;
      cerrarFila();
    } else {
      celda += c;
    }
  }
  cerrarFila();
  return filas;
}

/** Parsea un CSV con encabezado a objetos { columna: valor } (celdas faltantes = ''). */
export function parseCsv(csv: string): Record<string, string>[] {
  const filas = parsearFilas(csv);
  if (filas.length === 0) return [];
  const cols = filas[0];
  return filas.slice(1).map((celdas) => {
    const fila: Record<string, string> = {};
    cols.forEach((col, i) => (fila[col] = celdas[i] ?? ''));
    return fila;
  });
}

/** Escapa un campo CSV (RFC 4180) y neutraliza fórmulas de hoja de cálculo. */
export function celdaCsv(valor: unknown): string {
  let s = valor === null || valor === undefined ? '' : typeof valor === 'object' ? JSON.stringify(valor) : String(valor);
  if (s.length > 0 && INICIO_FORMULA.includes(s[0])) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
