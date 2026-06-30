import { redondear } from './redondeo';
import { CALIF_MAX, CALIF_MIN, PISO_INSTITUCIONAL, PesosParcial, ValorExamen } from './tipos';

/**
 * promedio_categoria = media de calificaciones con valor > 0.
 * Ignora ceros, null/undefined y vacíos. Sin calificaciones válidas ⇒ 0.
 */
export function promedioCategoria(valores: ReadonlyArray<number | null | undefined>): number {
  const validas = valores.filter((v): v is number => typeof v === 'number' && v > 0);
  if (validas.length === 0) return 0;
  return validas.reduce((acc, v) => acc + v, 0) / validas.length;
}

/** evaluacion_continua = promTI*pesoTI + promTE*pesoTE + promTA*pesoTA. */
export function evaluacionContinua(
  promTI: number,
  promTE: number,
  promTA: number,
  pesos: PesosParcial,
): number {
  return promTI * pesos.ti + promTE * pesos.te + promTA * pesos.ta;
}

/**
 * examen_ponderado = SDE ? "SDE" : examen * pesoEX.
 * Un examen "NP" (no presentado) aporta 0. Útil para presentación; el cálculo
 * crudo usa calificacionCrudaParcial directamente.
 */
export function examenPonderado(examen: ValorExamen, pesoEX: number, sde: boolean): number | 'SDE' {
  if (sde) return 'SDE';
  if (examen === 'NP') return 0;
  return examen * pesoEX;
}

/**
 * calif_cruda_parcial:
 *   SDE  ⇒ evaluacion_continua            (el examen no suma)
 *   else ⇒ evaluacion_continua + examen_ponderado   (examen NP aporta 0)
 */
export function calificacionCrudaParcial(params: {
  promTI: number;
  promTE: number;
  promTA: number;
  pesos: PesosParcial;
  examen: ValorExamen;
  sde: boolean;
}): number {
  const ec = evaluacionContinua(params.promTI, params.promTE, params.promTA, params.pesos);
  if (params.sde) return ec;
  const examenNum = params.examen === 'NP' ? 0 : params.examen;
  return ec + examenNum * params.pesos.ex;
}

/** RN-03 — Piso de 5: una cruda en [5,6) se eleva a 5 ANTES de redondear. */
export function aplicarPiso5(cruda: number): number {
  if (cruda >= PISO_INSTITUCIONAL && cruda < PISO_INSTITUCIONAL + 1) return PISO_INSTITUCIONAL;
  return cruda;
}

/**
 * calif_final_parcial = aplicar_piso_5(cruda) → ROUND → + punto_extra.
 * El resultado se acota al rango [0,10] (el punto extra no supera 10).
 */
export function calificacionFinalParcial(cruda: number, puntoExtra: boolean): number {
  const conPiso = aplicarPiso5(cruda);
  const redondeada = redondear(conPiso);
  const conExtra = redondeada + (puntoExtra ? 1 : 0);
  return Math.min(CALIF_MAX, Math.max(CALIF_MIN, conExtra));
}
