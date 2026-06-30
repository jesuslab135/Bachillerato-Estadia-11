import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { RolUsuario } from '@prisma/client';
import { ALLOW_WHILE_MUST_CHANGE_KEY, IS_PUBLIC_KEY, JwtPayload, ROLES_KEY } from './auth.types';

/** Ruta accesible sin token (p. ej. login). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Ruta permitida aun cuando el usuario tenga cambio de contraseña pendiente. */
export const AllowWhileMustChange = () => SetMetadata(ALLOW_WHILE_MUST_CHANGE_KEY, true);

/** Restringe la ruta a los roles indicados. */
export const Roles = (...roles: RolUsuario[]) => SetMetadata(ROLES_KEY, roles);

/** Inyecta el usuario autenticado (payload del JWT) en el handler. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    return ctx.switchToHttp().getRequest().user;
  },
);
