import { RolUsuario } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  email: string;
  rol: RolUsuario;
  plantelId: string | null;
  debeCambiar: boolean;
}

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const ALLOW_WHILE_MUST_CHANGE_KEY = 'auth:allowWhileMustChange';
export const ROLES_KEY = 'auth:roles';
