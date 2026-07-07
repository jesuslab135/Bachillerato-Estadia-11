import { ConflictException } from '@nestjs/common';
import { EstadoParcial } from '@prisma/client';

/**
 * RN-06 — Estados en los que el parcial es inmutable: toda captura (calificación,
 * examen, punto extra y asistencia cuya fecha cae en su ventana) se rechaza.
 * La reapertura formal por Coordinación es la única vía de edición.
 */
export const ESTADOS_BLOQUEADOS: EstadoParcial[] = ['CerradoDocente', 'Validado'];

/**
 * FB-B-7 — Las columnas de ventana son anulables en DB: en vez de asertar con `!`
 * (y estallar con 500), se responde 409 con instrucción accionable.
 */
export function ventanaDeParcial(parcial: { numero: number; fechaInicio: Date | null; fechaFin: Date | null }): {
  inicio: Date;
  fin: Date;
} {
  if (!parcial.fechaInicio || !parcial.fechaFin) {
    throw new ConflictException(
      `El parcial ${parcial.numero} no tiene ventana de fechas definida: configure fechaInicio/fechaFin antes de operar`,
    );
  }
  return { inicio: parcial.fechaInicio, fin: parcial.fechaFin };
}
