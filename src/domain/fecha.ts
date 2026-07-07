/**
 * FB-B-10 — Fecha local del plantel (dominio puro, sin dependencias).
 *
 * "Hoy" debe calcularse en la zona horaria de los planteles, no en UTC:
 * con `toISOString()` el panel mostraba el día siguiente entre las 18:00 y
 * las 00:00 locales. Ambos planteles v1.0 (Bordes Mangel y Bonilla Colmenero)
 * están en el centro de México; si algún día hay planteles en otra zona,
 * esta constante pasará a configuración por plantel.
 */
export const TZ_PLANTELES = 'America/Mexico_City';

/** Devuelve la fecha `YYYY-MM-DD` de `ahora` vista desde la zona `tz` (Intl, sin librerías). */
export function fechaLocalISO(tz: string = TZ_PLANTELES, ahora: Date = new Date()): string {
  // El locale en-CA formatea como YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);
}
