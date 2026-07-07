import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { AllowWhileMustChange, CurrentUser, Public, Roles } from './decorators';
import { ChangePasswordDto, DesbloquearDto, LoginDto } from './dto';
import { JwtPayload } from './auth.types';

// FB-B-5 — límite propio del login (anti fuerza bruta/spraying entre cuentas), más estricto
// que el global. Resolvable: lee el entorno en tiempo de request para poder ajustarlo por
// entorno (los e2e usan THROTTLE_LOGIN_LIMIT alto en .env; producción debe usar ~10/min).
const LOGIN_THROTTLE = {
  default: {
    limit: () => Number(process.env.THROTTLE_LOGIN_LIMIT ?? 10),
    ttl: () => Number(process.env.THROTTLE_LOGIN_TTL ?? 60_000),
  },
};

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle(LOGIN_THROTTLE)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Req() req: { ip?: string }) {
    return this.auth.login(dto.email, dto.password, req.ip ?? null);
  }

  @AllowWhileMustChange()
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  changePassword(@CurrentUser() user: JwtPayload, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user.sub, dto.actual, dto.nueva);
  }

  @Roles('Coordinador', 'Operador')
  @Post('desbloquear')
  @HttpCode(HttpStatus.OK)
  desbloquear(@CurrentUser() user: JwtPayload, @Body() dto: DesbloquearDto) {
    return this.auth.desbloquear(dto.email, user);
  }
}
