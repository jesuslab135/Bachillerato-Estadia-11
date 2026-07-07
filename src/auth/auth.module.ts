import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtSignOptions } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { MustChangePasswordGuard } from './guards/must-change-password.guard';
import { RolesGuard } from './guards/roles.guard';

/** FB-B-5 — fail-fast: sin JWT_SECRET el proceso NO arranca (nada de secretos por defecto). */
export function exigirJwtSecret(valor: string | undefined): string {
  if (!valor || valor.trim() === '') {
    throw new Error('JWT_SECRET no está definido: configure la variable de entorno antes de arrancar (FB-B-5)');
  }
  return valor;
}

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: exigirJwtSecret(config.get<string>('JWT_SECRET')),
        // El valor viene de config como string (p. ej. "8h"); JwtModule espera number | ms.StringValue.
        signOptions: { expiresIn: (config.get<string>('JWT_EXPIRES_IN') ?? '8h') as JwtSignOptions['expiresIn'] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    // Orden de guardias globales: autenticar → exigir cambio → autorizar rol.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: MustChangePasswordGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [JwtModule],
})
export class AuthModule {}
