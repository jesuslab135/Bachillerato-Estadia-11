import { ConteoAsistencia } from './tipos';

/**
 * porcentaje_asistencia = (asistencias + retardos) / total_clases
 * total_clases = A + F + R + J (todas las sesiones registradas).
 * Sin sesiones registradas ⇒ 0.
 */
export function porcentajeAsistencia(conteo: ConteoAsistencia): number {
  const total = conteo.A + conteo.F + conteo.R + conteo.J;
  if (total === 0) return 0;
  return (conteo.A + conteo.R) / total;
}
