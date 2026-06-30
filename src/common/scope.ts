import { ForbiddenException } from '@nestjs/common';
import { JwtPayload } from '../auth/auth.types';

/**
 * RF-AUTH-03 — Cada usuario ve solo datos de su plantel; el Operador es global.
 * Devuelve un fragmento de `where` de Prisma para acotar consultas por plantel.
 */
export function filtroPlantel(user: JwtPayload): { plantelId?: string } {
  if (user.rol === 'Operador') return {};
  return { plantelId: user.plantelId ?? '__sin_plantel__' };
}

/** Lanza 403 si un usuario no-Operador intenta operar sobre un plantel ajeno. */
export function aseguraAccesoPlantel(user: JwtPayload, plantelId: string): void {
  if (user.rol === 'Operador') return;
  if (user.plantelId !== plantelId) {
    throw new ForbiddenException('No tiene acceso a datos de otro plantel');
  }
}
