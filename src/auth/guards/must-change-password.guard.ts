import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOW_WHILE_MUST_CHANGE_KEY, IS_PUBLIC_KEY, JwtPayload } from '../auth.types';

/**
 * RF-AUTH-04 — Con cambio de contraseña pendiente, el usuario no puede acceder a
 * nada salvo a las rutas marcadas con @AllowWhileMustChange (cambiar contraseña).
 */
@Injectable()
export class MustChangePasswordGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const metas = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, metas)) return true;
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_WHILE_MUST_CHANGE_KEY, metas)) return true;

    const user: JwtPayload | undefined = context.switchToHttp().getRequest().user;
    if (user?.debeCambiar) {
      throw new ForbiddenException('Debe cambiar la contraseña antes de continuar');
    }
    return true;
  }
}
