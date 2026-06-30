import { redondear } from './redondeo';
import { CALIFICACION_APROBATORIA, InstanciaRecuperacion, NotaParcial } from './tipos';

export type Observacion = '' | 'Presenta Ordinario' | 'Presenta Extraordinario' | 'Habilita TDS';

export interface EntradaSemestre {
  /** Las 3 calificaciones finales de parcial (número o "NP"). */
  parciales: readonly [NotaParcial, NotaParcial, NotaParcial];
  ordinario?: InstanciaRecuperacion;
  extraordinario?: InstanciaRecuperacion;
  tds?: InstanciaRecuperacion;
}

/** "NP" o número < 6 cuenta como reprobado; "NP" promedia como 0. */
function esReprobado(nota: NotaParcial | number): boolean {
  return nota === 'NP' || nota < CALIFICACION_APROBATORIA;
}

function aNumero(nota: NotaParcial): number {
  return nota === 'NP' ? 0 : nota;
}

/** Una instancia es válida si trae nota numérica (no "NP", no null). */
function instanciaValida(x: InstanciaRecuperacion | undefined): number | null {
  return typeof x === 'number' ? x : null;
}

function promedio(notas: readonly number[]): number {
  return notas.reduce((acc, n) => acc + n, 0) / notas.length;
}

/**
 * RN-04 — Cascada de aprobación semestral. Precedencia del primer valor válido:
 *   1. TDS            → nota directa
 *   2. Extraordinario → nota directa
 *   3. Ordinario      → promedio recalculado reemplazando los parciales reprobados
 *   4. Promedio de los 3 parciales
 * Todo el resultado se redondea (half-up).
 */
export function calificacionFinalSemestre(entrada: EntradaSemestre): number {
  const tds = instanciaValida(entrada.tds);
  if (tds !== null) return redondear(tds);

  const extra = instanciaValida(entrada.extraordinario);
  if (extra !== null) return redondear(extra);

  const ordinario = instanciaValida(entrada.ordinario);
  if (ordinario !== null) {
    const recomputados = entrada.parciales.map((p) => (esReprobado(p) ? ordinario : aNumero(p)));
    return redondear(promedio(recomputados));
  }

  return redondear(promedio(entrada.parciales.map(aNumero)));
}

/**
 * Observación automática. Si el extraordinario existe y fue reprobado, habilita TDS;
 * en otro caso, se deriva del número de parciales reprobados.
 */
export function observacionSemestral(entrada: EntradaSemestre): Observacion {
  const extra = entrada.extraordinario;
  if (extra !== undefined && extra !== null) {
    return esReprobado(extra) ? 'Habilita TDS' : '';
  }

  const reprobados = entrada.parciales.filter(esReprobado).length;
  if (reprobados === 0) return '';
  if (reprobados === 1) return 'Presenta Ordinario';
  return 'Presenta Extraordinario';
}
