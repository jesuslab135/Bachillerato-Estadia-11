import { UMBRAL_FALTAS_SDE } from './tipos';

/**
 * RN-01 — Derecho a examen.
 * Un cadete pierde el derecho (SDE) al acumular `UMBRAL_FALTAS_SDE` (3) o más
 * faltas no justificadas (código `F`) en el parcial. Retardos (`R`) y faltas
 * justificadas (`J`) NO cuentan. La reevaluación al cambiar F→J es simplemente
 * volver a invocar esta función con el nuevo conteo.
 */
export function tieneDerechoExamen(faltasNoJustificadas: number): boolean {
  return faltasNoJustificadas < UMBRAL_FALTAS_SDE;
}

export function esSDE(faltasNoJustificadas: number): boolean {
  return !tieneDerechoExamen(faltasNoJustificadas);
}
