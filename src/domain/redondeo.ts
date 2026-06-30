/**
 * Redondeo escolar mitad-hacia-arriba (half-up): 5.5→6, 6.5→7, 7.5→8.
 * Las calificaciones del dominio son ≥ 0, por lo que floor(x + 0.5) es correcto.
 */
export function redondear(x: number): number {
  return Math.floor(x + 0.5);
}
