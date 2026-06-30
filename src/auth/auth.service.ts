import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Usuario } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from './auth.types';

const BCRYPT_COST = 12; // modelo.md: cost ≥ 12

export interface LoginResultado {
  accessToken: string;
  debeCambiarContrasena: boolean;
}

@Injectable()
export class AuthService {
  private readonly maxIntentos: number;
  private readonly bloqueoMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.maxIntentos = Number(config.get('AUTH_MAX_INTENTOS') ?? 5);
    this.bloqueoMs = Number(config.get('AUTH_BLOQUEO_MINUTOS') ?? 15) * 60_000;
  }

  private firmar(user: Usuario): string {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      rol: user.rol,
      plantelId: user.plantelId,
      debeCambiar: user.debeCambiarContrasena,
    };
    return this.jwt.sign(payload);
  }

  private async auditar(tipoEvento: string, ip: string | null, usuarioId: string | null, extra?: object) {
    await this.prisma.auditLog.create({
      data: {
        tipoEvento,
        ip,
        usuarioId,
        entidad: 'Usuario',
        entidadId: usuarioId,
        valorNuevoJson: extra ?? undefined,
      },
    });
  }

  async login(email: string, password: string, ip: string | null): Promise<LoginResultado> {
    const user = await this.prisma.usuario.findUnique({ where: { email } });

    if (!user || !user.activo) {
      await this.auditar('LOGIN_FALLIDO', ip, null, { email, motivo: 'inexistente_o_inactivo' });
      throw new UnauthorizedException('Credenciales inválidas');
    }

    if (user.bloqueadoHasta && user.bloqueadoHasta.getTime() > Date.now()) {
      await this.auditar('LOGIN_BLOQUEADO', ip, user.id, { email });
      throw new HttpException('Cuenta bloqueada por intentos fallidos', HttpStatus.LOCKED);
    }

    const ok = await bcrypt.compare(password, user.hashContrasena);
    if (!ok) {
      const intentos = user.intentosFallidos + 1;
      const alcanzaTope = intentos >= this.maxIntentos;
      await this.prisma.usuario.update({
        where: { id: user.id },
        data: {
          intentosFallidos: intentos,
          bloqueadoHasta: alcanzaTope ? new Date(Date.now() + this.bloqueoMs) : user.bloqueadoHasta,
        },
      });
      await this.auditar('LOGIN_FALLIDO', ip, user.id, { email, intentos });
      throw new UnauthorizedException('Credenciales inválidas');
    }

    await this.prisma.usuario.update({
      where: { id: user.id },
      data: { intentosFallidos: 0, bloqueadoHasta: null, fechaUltimoAcceso: new Date() },
    });
    await this.auditar('LOGIN_OK', ip, user.id, { email });

    return { accessToken: this.firmar(user), debeCambiarContrasena: user.debeCambiarContrasena };
  }

  async changePassword(userId: string, actual: string, nueva: string): Promise<LoginResultado> {
    const user = await this.prisma.usuario.findUniqueOrThrow({ where: { id: userId } });
    const ok = await bcrypt.compare(actual, user.hashContrasena);
    if (!ok) throw new UnauthorizedException('Contraseña actual incorrecta');

    const hash = await bcrypt.hash(nueva, BCRYPT_COST);
    const actualizado = await this.prisma.usuario.update({
      where: { id: userId },
      data: { hashContrasena: hash, debeCambiarContrasena: false },
    });
    await this.auditar('CAMBIO_CONTRASENA', null, userId);

    return { accessToken: this.firmar(actualizado), debeCambiarContrasena: false };
  }

  // RF-AUTH-05 — Coordinador/Operador desbloquea una cuenta.
  async desbloquear(email: string, ejecutorId: string): Promise<{ desbloqueado: boolean }> {
    const user = await this.prisma.usuario.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException('Usuario no existe');
    await this.prisma.usuario.update({
      where: { id: user.id },
      data: { intentosFallidos: 0, bloqueadoHasta: null },
    });
    await this.auditar('DESBLOQUEO', null, user.id, { por: ejecutorId });
    return { desbloqueado: true };
  }
}
